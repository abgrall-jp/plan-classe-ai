import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI, Type } from "@google/genai";

// ---------------------------------------------------------------------------
// Serveur du Plan de classe IA (hébergement o2switch).
// Le navigateur ne lit ni n'écrit plus jamais la base : tout passe par ce serveur, qui vérifie qui demande quoi.
//   - enseignants : connexion Firebase (Google ou e-mail) ; chacun ne voit et ne modifie que ses plans et ses photos ;
//   - élèves et parents : mot de passe du plan, vérifié ici (empreinte scrypt, jamais en clair), puis jeton signé ;
//   - la clé Gemini reste sur le serveur.
// Réglages (variables d'environnement, dans cPanel > Setup Node.js App)
//   FIREBASE_SERVICE_ACCOUNT  clé JSON d'un compte de service (sinon fichier service-account.json)
//   FIRESTORE_DATABASE_ID     base Firestore (sinon celle de firebase-applet-config.json)
//   GEMINI_API_KEY            clé de l'API Gemini
//   SESSION_SECRET            secret des connexions élève et parent (sinon tiré au hasard au démarrage)
//   ADMIN_EMAILS              administrateurs, séparés par des virgules (alimatlea@gmail.com)
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const APP_VERSION = "2026-10-24.1";

function readJsonFile(fileName: string): any {
  try {
    const p = path.join(process.cwd(), fileName);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`Lecture impossible de ${fileName} :`, e);
  }
  return null;
}

const appletConfig = readJsonFile("firebase-applet-config.json") || {};
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!); } catch { console.error("FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide"); return null; } })()
  : readJsonFile("service-account.json");
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || appletConfig.projectId;
const databaseId = process.env.FIRESTORE_DATABASE_ID || appletConfig.firestoreDatabaseId || "(default)";
const adminApp = getApps()[0] || initializeApp({ projectId, ...(serviceAccount ? { credential: cert(serviceAccount) } : {}) });
const adminAuth = getAuth(adminApp);
const db = databaseId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, databaseId);
db.settings({ ignoreUndefinedProperties: true });

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS ?? "alimatlea@gmail.com").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_HEURES = 12;
const MDP_DEFAUT = "0000";

// --- Petits outils ---------------------------------------------------------------------
const isSafeId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 300 && !v.includes("/") && v !== "." && v !== "..";

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function route(fn: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      const status = Number(e?.status) || 500;
      if (status >= 500) console.error(`${req.method} ${req.path}`, e);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? "Erreur du serveur. Réessayez." : e.message });
    }
  };
}

// Adresse du visiteur : la dernière ajoutée par le serveur web d'o2switch (les précédentes peuvent être inventées).
function clientIp(req: Request): string {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",").map(x => x.trim()).filter(Boolean);
  return fwd[fwd.length - 1] || req.socket.remoteAddress || "?";
}

function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 50000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    return ++h.count <= max;
  };
}
const limiteConnexionIp = makeLimiter(30, 15 * 60 * 1000);
const limiteConnexionEleve = makeLimiter(8, 15 * 60 * 1000);
const limiteGemini = makeLimiter(60, 60 * 60 * 1000);

/** Nom d'élève comparable (même règle que le navigateur) : minuscules, sans accents ni numéro devant. */
function normaliserNom(name: string): string {
  if (!name) return "";
  const sansNumero = name.replace(/^\s*\d+[\s.\-):]+\s*/, "").trim() || name;
  return sansNumero.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

// --- Mots de passe des élèves : empreinte scrypt -----------------------------------------
const empreinte = (mdp: string) => {
  const sel = crypto.randomBytes(16);
  return `scrypt:${sel.toString("hex")}:${crypto.scryptSync(mdp, sel, 32).toString("hex")}`;
};
function correspond(mdp: string, e: string): boolean {
  const [, sel, attendue] = String(e).split(":");
  if (!sel || !attendue) return false;
  const calculee = crypto.scryptSync(mdp, Buffer.from(sel, "hex"), 32);
  const b = Buffer.from(attendue, "hex");
  return b.length === calculee.length && crypto.timingSafeEqual(calculee, b);
}

type EntreeMdp = { hash?: string; password?: string; isDefault?: boolean; updatedAt?: string };

/** Vérifie un mot de passe. Un ancien mot de passe en clair qui correspond est remplacé par son empreinte. */
function verifierMdp(entree: EntreeMdp | undefined, saisi: string): { ok: boolean; aChanger: boolean; nouvelleEntree?: EntreeMdp } {
  const s = String(saisi || "").trim();
  if (!s) return { ok: false, aChanger: false };
  if (entree?.hash) return { ok: correspond(s, entree.hash), aChanger: false };
  if (entree?.password && entree.password !== MDP_DEFAUT && !entree.isDefault) {
    if (s !== entree.password) return { ok: false, aChanger: false };
    return { ok: true, aChanger: false, nouvelleEntree: { hash: empreinte(s), isDefault: false, updatedAt: entree.updatedAt || new Date().toISOString() } };
  }
  // Pas encore de mot de passe personnel : 0000, à changer à la première connexion.
  return { ok: s === MDP_DEFAUT, aChanger: s === MDP_DEFAUT };
}

/** Ce que le navigateur de l'enseignant voit des mots de passe : seulement s'ils sont encore ceux par défaut. */
function mdpPourEnseignant(mdps: Record<string, EntreeMdp> | undefined) {
  const out: Record<string, { password: string; isDefault: boolean; updatedAt?: string }> = {};
  for (const [id, e] of Object.entries(mdps || {})) {
    const parDefaut = !e?.hash && (!e?.password || e.password === MDP_DEFAUT || !!e.isDefault);
    out[id] = { password: parDefaut ? MDP_DEFAUT : "", isDefault: parDefaut, updatedAt: e?.updatedAt };
  }
  return out;
}

/**
 * Mots de passe envoyés par l'enseignant avec un plan : un mot de passe écrit est remplacé par son empreinte,
 * « 0000 » remet le mot de passe par défaut, une case vide garde le mot de passe enregistré.
 */
function fusionnerMdp(recus: Record<string, any> | undefined, enregistres: Record<string, EntreeMdp> | undefined, ids: string[]) {
  const out: Record<string, EntreeMdp> = {};
  const now = new Date().toISOString();
  for (const id of ids) {
    const r = recus?.[id];
    const avant = enregistres?.[id];
    const saisi = typeof r?.password === "string" ? r.password.trim().slice(0, 64) : "";
    if (saisi === MDP_DEFAUT) out[id] = avant?.isDefault && !avant.hash ? avant : { isDefault: true, updatedAt: now };
    else if (saisi) out[id] = { hash: empreinte(saisi), isDefault: false, updatedAt: now };
    else if (avant) out[id] = avant.hash || avant.isDefault || !avant.password || avant.password === MDP_DEFAUT
      ? avant
      : { hash: empreinte(avant.password), isDefault: false, updatedAt: avant.updatedAt || now };
    else out[id] = { isDefault: true, updatedAt: now };
  }
  return out;
}

// --- Sessions élève et parent : jeton signé ----------------------------------------------
type Session = { r: "student" | "parent"; pid: string; sid: number; exp: number };
function signerSession(p: Omit<Session, "exp">): string {
  const payload = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + SESSION_HEURES * 3600e3 })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url")}`;
}
function lireSession(token: string): Session | null {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const attendu = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(attendu);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!p || (p.r !== "student" && p.r !== "parent") || !isSafeId(p.pid) || typeof p.sid !== "number" || !(p.exp > Date.now())) return null;
    return p;
  } catch {
    return null;
  }
}
const sessionDe = (req: Request) => {
  const s = lireSession(String(req.headers["x-session"] || ""));
  if (!s) throw httpError(401, "Connexion expirée. Reconnecte-toi avec ton mot de passe.");
  return s;
};

// --- Enseignants ---------------------------------------------------------------------------
type Enseignant = { uid: string; email: string; emailVerifie: boolean; isAdmin: boolean; profil: any };

async function lireJeton(req: Request): Promise<DecodedIdToken | null> {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return await adminAuth.verifyIdToken(h.slice(7).trim()); } catch { return null; }
}

function profilParDefaut(uid: string, email: string, nom?: string, photo?: string) {
  const parts = String(nom || "").trim().split(/\s+/).filter(Boolean);
  const admin = ADMIN_EMAILS.includes(email);
  return {
    uid, email,
    firstName: admin ? "JP" : parts[0] || (email.split("@")[0] || "").replace(/^./, c => c.toUpperCase()),
    lastName: admin ? "Abgrall" : parts.slice(1).join(" "),
    disciplines: admin ? ["Administration Globale", "Informatique"] : [],
    classes: admin ? ["Toutes les classes"] : [],
    role: admin ? "super_admin" : "teacher",
    ...(photo ? { photoURL: photo } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function profil(uid: string, email: string, nom?: string, photo?: string) {
  const ref = db.doc(`teachers/${uid}`);
  const snap = await ref.get();
  const role = ADMIN_EMAILS.includes(email) ? "super_admin" : "teacher";
  if (!snap.exists) {
    const p = profilParDefaut(uid, email, nom, photo);
    await ref.set(p);
    return p;
  }
  const p = snap.data()!;
  if (p.role !== role) { await ref.set({ role }, { merge: true }); p.role = role; }
  return p;
}

/** Enseignant connecté. L'administrateur peut agir à la place d'un enseignant (en-tête X-Impersonate). */
function exigerEnseignant() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await lireJeton(req);
      if (!t) return res.status(401).json({ error: "Connexion enseignant requise." });
      const email = String(t.email || "").toLowerCase();
      const emailVerifie = t.email_verified === true;
      const isAdmin = emailVerifie && ADMIN_EMAILS.includes(email);
      let ens: Enseignant = { uid: t.uid, email, emailVerifie, isAdmin, profil: await profil(t.uid, email, t.name, t.picture) };
      const cible = String(req.headers["x-impersonate"] || "");
      if (cible && cible !== t.uid) {
        if (!isAdmin) return res.status(403).json({ error: "Réservé à l'administrateur." });
        if (!isSafeId(cible)) return res.status(400).json({ error: "Enseignant incorrect." });
        const p = (await db.doc(`teachers/${cible}`).get()).data();
        if (!p) return res.status(404).json({ error: "Enseignant introuvable." });
        ens = { uid: cible, email: String(p.email || "").toLowerCase(), emailVerifie: true, isAdmin: false, profil: p };
      }
      (req as any).ens = ens;
      next();
    } catch (e) { next(e); }
  };
}
const ensDe = (req: Request) => (req as any).ens as Enseignant;

/** Un plan appartient à l'enseignant : par son compte, par son adresse (si elle est vérifiée), ou (anciens plans sans propriétaire) par ses classes. */
function possede(plan: any, e: Enseignant): boolean {
  if (e.isAdmin) return true;
  if (plan.teacherId || plan.teacherEmail) {
    if (plan.teacherId && plan.teacherId === e.uid) return true;
    return e.emailVerifie && !!plan.teacherEmail && String(plan.teacherEmail).trim().toLowerCase() === e.email;
  }
  if (!plan.className) return false;
  const classes = (Array.isArray(e.profil?.classes) ? e.profil.classes : []).map((c: string) => String(c).trim().toLowerCase());
  return String(plan.className).split(",").map((c: string) => c.trim().toLowerCase()).some((c: string) => classes.includes(c));
}

const pourEnseignant = (plan: any) => ({ ...plan, studentPasswords: mdpPourEnseignant(plan.studentPasswords) });

// --- Plans de l'enseignant -----------------------------------------------------------------
const app = express();
app.set("trust proxy", false);
app.use(express.json({ limit: "6mb" }));
app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "same-origin"); next(); });

app.get("/api/health", route(async (req, res) => {
  const out: any = { status: "ok", version: APP_VERSION };
  if (req.query.db !== undefined) {
    out.projet = projectId; out.base = databaseId; out.gemini = !!process.env.GEMINI_API_KEY;
    try { await db.collection("publishedPlans").limit(1).get(); out.acces = "ok"; } catch (e: any) { out.acces = String(e?.message || e).slice(0, 200); }
  }
  res.json(out);
}));

app.get("/api/teacher/me", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  res.json({ ...e.profil, uid: e.uid, email: e.profil.email || e.email });
}));

app.put("/api/teacher/me", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const b = req.body || {};
  const liste = (v: unknown) => (Array.isArray(v) ? v.slice(0, 100).map(x => String(x).slice(0, 80)) : undefined);
  const maj: any = { updatedAt: new Date().toISOString() };
  if (typeof b.firstName === "string") maj.firstName = b.firstName.slice(0, 80);
  if (typeof b.lastName === "string") maj.lastName = b.lastName.slice(0, 80);
  if (liste(b.disciplines)) maj.disciplines = liste(b.disciplines);
  if (liste(b.classes)) maj.classes = liste(b.classes);
  if (typeof b.photoURL === "string" && b.photoURL.length < 2000) maj.photoURL = b.photoURL;
  await db.doc(`teachers/${e.uid}`).set(maj, { merge: true });
  const p = (await db.doc(`teachers/${e.uid}`).get()).data();
  res.json(p);
}));

app.get("/api/admin/teachers", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  const snap = await db.collection("teachers").get();
  res.json(snap.docs.map(d => d.data()));
}));

app.get("/api/plans", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const snap = await db.collection("publishedPlans").get();
  res.json(snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(p => possede(p, e)).map(pourEnseignant));
}));

app.put("/api/plans/:id", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const id = req.params.id;
  if (!isSafeId(id) || id.startsWith("demo-")) throw httpError(400, "Plan incorrect.");
  const plan = req.body || {};
  if (typeof plan !== "object" || Array.isArray(plan)) throw httpError(400, "Plan incorrect.");
  const ref = db.doc(`publishedPlans/${id}`);
  const enregistre = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const avant = snap.exists ? snap.data()! : null;
    if (avant && !possede(avant, e)) throw httpError(403, "Ce plan appartient à un autre enseignant.");
    const placements = Array.isArray(plan.placements) ? plan.placements.slice(0, 200) : [];
    const ids = placements.map((p: any) => String(p?.id)).filter((x: string) => x && x !== "undefined");
    const nouveau = {
      ...plan,
      id,
      // Le propriétaire ne change pas ; un nouveau plan (ou un ancien sans propriétaire) est rattaché à l'enseignant.
      teacherId: avant?.teacherId || e.uid,
      teacherEmail: avant?.teacherEmail || e.email,
      placements,
      studentPasswords: fusionnerMdp(plan.studentPasswords, avant?.studentPasswords, ids),
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, JSON.parse(JSON.stringify(nouveau)));
    return nouveau;
  });
  res.json(pourEnseignant(enregistre));
}));

app.delete("/api/plans/:id", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const id = req.params.id;
  if (!isSafeId(id)) throw httpError(400, "Plan incorrect.");
  const ref = db.doc(`publishedPlans/${id}`);
  const snap = await ref.get();
  if (snap.exists && !possede(snap.data(), e)) throw httpError(403, "Ce plan appartient à un autre enseignant.");
  await ref.delete();
  res.json({ ok: true });
}));

// --- Photos des élèves (enseignant) ----------------------------------------------------------
// studentPhotos/{uid}__{clé} : photos de l'enseignant. Les anciennes photos sans propriétaire restent visibles
// pour les enseignants qui ont un élève de ce nom dans leurs plans.
const clePhoto = (key: string) => normaliserNom(key).replace(/[^a-z0-9]/g, "_").slice(0, 150);

async function nomsDesPlans(e: Enseignant): Promise<Set<string>> {
  const snap = await db.collection("publishedPlans").get();
  const noms = new Set<string>();
  for (const d of snap.docs) if (possede(d.data(), e)) for (const p of d.get("placements") || []) if (p?.name) noms.add(normaliserNom(p.name));
  return noms;
}

app.get("/api/photos", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const [miennes, anciennes, noms] = await Promise.all([
    db.collection("studentPhotos").where("ownerId", "==", e.uid).get(),
    db.collection("studentPhotos").get(),
    nomsDesPlans(e),
  ]);
  const out = new Map<string, any>();
  for (const d of anciennes.docs) {
    const x = d.data();
    if (!x.ownerId && x.key && noms.has(normaliserNom(x.name || x.key))) out.set(x.key, { key: x.key, name: x.name, photoUrl: x.photoUrl, className: x.className || "" });
  }
  for (const d of miennes.docs) { const x = d.data(); out.set(x.key, { key: x.key, name: x.name, photoUrl: x.photoUrl, className: x.className || "" }); }
  res.json(Array.from(out.values()));
}));

app.put("/api/photos", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const liste = Array.isArray(req.body) ? req.body.slice(0, 300) : [];
  const batch = db.batch();
  let n = 0;
  for (const x of liste) {
    const name = String(x?.name || "").trim().slice(0, 120);
    const key = normaliserNom(name);
    const photoUrl = String(x?.photoUrl || "");
    if (!key || !/^data:image\/(webp|jpeg|png);base64,/.test(photoUrl) || photoUrl.length > 400000) continue;
    batch.set(db.doc(`studentPhotos/${e.uid}__${clePhoto(key)}`), { key, name, photoUrl, className: String(x?.className || "").slice(0, 80), ownerId: e.uid, updatedAt: new Date().toISOString() });
    n++;
  }
  if (n) await batch.commit();
  res.json({ ok: true, enregistrees: n });
}));

app.delete("/api/photos/:key", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const key = normaliserNom(String(req.params.key || ""));
  if (!key) throw httpError(400, "Nom incorrect.");
  await db.doc(`studentPhotos/${e.uid}__${clePhoto(key)}`).delete();
  // Ancienne photo sans propriétaire : supprimée si l'élève est dans les plans de cet enseignant.
  const ancienne = db.doc(`studentPhotos/${key.replace(/[^a-z0-9]/g, "_")}`);
  const snap = await ancienne.get();
  if (snap.exists && !snap.get("ownerId") && (await nomsDesPlans(e)).has(key)) await ancienne.delete();
  res.json({ ok: true });
}));

// --- Portail élève et parent ------------------------------------------------------------------
/** Ce que tout le monde voit d'un plan : la salle et les prénoms, sans photos, remarques, mots de passe ni adresse. */
function planPublic(p: any) {
  return {
    id: p.id, teacherName: p.teacherName || "", className: p.className || "", period: p.period || "", academicYear: p.academicYear,
    allowStudentSelfPlacement: !!p.allowStudentSelfPlacement, isFrozen: !!p.isFrozen, isPast: !!p.isPast, isPastPlan: !!p.isPastPlan,
    gridDimensions: p.gridDimensions || { rows: 5, cols: 6 }, unavailableCells: p.unavailableCells || [], cellObstacles: p.cellObstacles || {},
    placements: (Array.isArray(p.placements) ? p.placements : []).map((x: any) => ({ id: x?.id, name: x?.name, rollNumber: x?.rollNumber, location: x?.location ?? "bank", groupId: x?.groupId })),
    updatedAt: p.updatedAt,
  };
}

/** Clés possibles des remarques d'un élève (même règle que le navigateur). */
const clesRemarques = (nom: string, id: number) => [String(nom || "").trim().toLowerCase(), `id_${id}`, String(id)];

/** Le plan vu par un élève ou un parent connecté : avec les photos de la classe, et seulement ses propres remarques. */
function planDeSession(p: any, s: Session) {
  const moi = (p.placements || []).find((x: any) => x?.id === s.sid);
  const remarques: Record<string, any> = {};
  if (moi) for (const k of clesRemarques(moi.name, s.sid)) if (Array.isArray(p.studentRemarks?.[k])) remarques[k] = p.studentRemarks[k];
  return {
    ...planPublic(p),
    placements: (p.placements || []).map((x: any) => ({ id: x?.id, name: x?.name, rollNumber: x?.rollNumber, location: x?.location ?? "bank", groupId: x?.groupId, photoUrl: x?.photoUrl })),
    studentRemarks: remarques,
  };
}

let cachePublic: { at: number; plans: any[] } | null = null;
app.get("/api/public/plans", route(async (_req, res) => {
  if (!cachePublic || Date.now() - cachePublic.at > 5000) {
    const snap = await db.collection("publishedPlans").get();
    cachePublic = { at: Date.now(), plans: snap.docs.map(d => planPublic({ ...d.data(), id: d.id })) };
  }
  res.json(cachePublic.plans);
}));

app.post("/api/public/login", route(async (req, res) => {
  const planId = String(req.body?.planId || "");
  const sid = Number(req.body?.studentId);
  const role = req.body?.role === "parent" ? "parent" : "student";
  if (!isSafeId(planId) || !Number.isFinite(sid)) throw httpError(400, "Choisis ton nom.");
  if (!limiteConnexionIp(clientIp(req)) || !limiteConnexionEleve(`${planId}:${sid}`)) throw httpError(429, "Trop d'essais. Réessaie dans un quart d'heure.");
  const ref = db.doc(`publishedPlans/${planId}`);
  const p = (await ref.get()).data();
  if (!p || !(p.placements || []).some((x: any) => x?.id === sid)) throw httpError(404, "Élève introuvable dans ce plan.");
  const v = verifierMdp(p.studentPasswords?.[String(sid)], String(req.body?.password || ""));
  if (!v.ok) throw httpError(403, "Mot de passe incorrect. (Par défaut : 0000)");
  if (v.nouvelleEntree) await ref.update({ [`studentPasswords.${sid}`]: v.nouvelleEntree });
  res.json({ token: signerSession({ r: role, pid: planId, sid }), requiresPasswordChange: v.aChanger });
}));

app.get("/api/public/session", route(async (req, res) => {
  const s = sessionDe(req);
  const p = (await db.doc(`publishedPlans/${s.pid}`).get()).data();
  if (!p || !(p.placements || []).some((x: any) => x?.id === s.sid)) throw httpError(404, "Ce plan n'existe plus.");
  res.json(planDeSession({ ...p, id: s.pid }, s));
}));

app.post("/api/public/password", route(async (req, res) => {
  const s = sessionDe(req);
  const mdp = String(req.body?.newPassword || "").trim();
  if (mdp.length < 4 || mdp.length > 64) throw httpError(400, "Le nouveau mot de passe doit comporter au moins 4 caractères.");
  if (mdp === MDP_DEFAUT) throw httpError(400, "Choisis un mot de passe différent de 0000.");
  await db.doc(`publishedPlans/${s.pid}`).update({ [`studentPasswords.${s.sid}`]: { hash: empreinte(mdp), isDefault: false, updatedAt: new Date().toISOString() } });
  cachePublic = null;
  res.json({ ok: true });
}));

app.post("/api/public/seat", route(async (req, res) => {
  const s = sessionDe(req);
  if (s.r !== "student") throw httpError(403, "Seul l'élève peut choisir sa place.");
  const loc = req.body?.location === "bank" ? "bank" : Number(req.body?.location);
  if (loc !== "bank" && (!Number.isInteger(loc) || loc < 0 || loc > 10000)) throw httpError(400, "Place incorrecte.");
  const ref = db.doc(`publishedPlans/${s.pid}`);
  const plan = await db.runTransaction(async tx => {
    const p = (await tx.get(ref)).data();
    if (!p) throw httpError(404, "Plan introuvable");
    if (p.isFrozen) throw httpError(409, "Ce plan est figé par l'enseignant. Les modifications ne sont pas autorisées.");
    if (!p.allowStudentSelfPlacement) throw httpError(409, "Le placement libre est désactivé par l'enseignant.");
    const { rows = 5, cols = 6 } = p.gridDimensions || {};
    if (loc !== "bank" && (loc >= rows * cols || (p.unavailableCells || []).includes(loc))) throw httpError(409, "Cet emplacement est indisponible dans la salle.");
    const placements = (p.placements || []).map((x: any) => ({ ...x }));
    const moi = placements.find((x: any) => x?.id === s.sid);
    if (!moi) throw httpError(404, "Élève introuvable dans ce plan.");
    if (loc !== "bank") {
      const occupant = placements.find((x: any) => x?.location === loc && x.id !== s.sid);
      if (occupant) occupant.location = moi.location ?? "bank";
    }
    moi.location = loc;
    tx.update(ref, { placements, updatedAt: new Date().toISOString() });
    return { ...p, placements };
  });
  cachePublic = null;
  res.json(planDeSession({ ...plan, id: s.pid }, s));
}));

// --- Gemini (enseignant) ------------------------------------------------------------------------
let ai: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw httpError(503, "La clé Gemini n'est pas réglée sur le serveur.");
  // GEMINI_BASE_URL sert uniquement aux essais (faux service Gemini local).
  ai ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  return ai;
}

app.post("/api/gemini/students", exigerEnseignant(), route(async (req, res) => {
  if (!limiteGemini(ensDe(req).uid)) throw httpError(429, "Trop de demandes à l'IA. Réessayez dans une heure.");
  const text = String(req.body?.text || "").slice(0, 50000);
  if (!text.trim()) throw httpError(400, "Liste vide.");
  const r = await gemini().models.generateContent({
    model: "gemini-3.7-flash",
    contents: `Analyse la liste brute d'élèves suivante et extrait chaque élève sous forme d'objet structuré.
Pour chaque élève, extrait :
- "name" : Le nom complet de l'élève (conserve fidèlement les prénoms composés, noms de famille, accents et casse).
- "rollNumber" : Le numéro d'appel ou rang éventuel de l'élève s'il est spécifié au début de ligne ou dans une colonne.

Nettoie les puces, tirets, symboles inutiles ou en-têtes de colonnes (comme "Nom", "Prénom", "Numéro", "Élèves").
Voici la liste brute à traiter :

${text}`,
    config: {
      systemInstruction: "Tu es un extracteur de données d'élèves pour les enseignants. Tu dois extraire avec rigueur, rapidité et fidélité les noms et numéros des élèves sans inventer d'information.",
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, rollNumber: { type: Type.STRING } }, required: ["name"] },
      },
    },
  });
  res.json({ text: r.text || "" });
}));

app.post("/api/gemini/trombi", exigerEnseignant(), route(async (req, res) => {
  if (!limiteGemini(ensDe(req).uid)) throw httpError(429, "Trop de demandes à l'IA. Réessayez dans une heure.");
  const image = String(req.body?.image || "");
  if (!image || image.length > 8_000_000) throw httpError(400, "Image incorrecte.");
  const prompt = String(req.body?.prompt || "").slice(0, 5000);
  const r = await gemini().models.generateContent({
    model: "gemini-3.8-flash",
    contents: [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text: prompt }],
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          className: { type: Type.STRING },
          year: { type: Type.STRING },
          students: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: { type: Type.STRING }, box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } }, isPlaceholder: { type: Type.BOOLEAN } },
              required: ["name", "box_2d"],
            },
          },
        },
        required: ["students"],
      },
    },
  });
  res.json({ text: r.text || "" });
}));

/** Au démarrage : les anciens mots de passe encore écrits en clair dans la base sont remplacés par leur empreinte. */
async function chiffrerAnciensMdp() {
  const snap = await db.collection("publishedPlans").get();
  let n = 0;
  for (const d of snap.docs) {
    const maj: Record<string, EntreeMdp> = {};
    for (const [id, e] of Object.entries((d.get("studentPasswords") || {}) as Record<string, EntreeMdp>)) {
      if (!e?.password || e.hash) continue;
      const parDefaut = e.password === MDP_DEFAUT || !!e.isDefault;
      maj[`studentPasswords.${id}`] = parDefaut ? { isDefault: true, updatedAt: e.updatedAt || "" } : { hash: empreinte(e.password), isDefault: false, updatedAt: e.updatedAt || "" };
    }
    if (Object.keys(maj).length) { await d.ref.update(maj); n += Object.keys(maj).length; }
  }
  if (n) console.log(`${n} ancien(s) mot(s) de passe chiffré(s).`);
}

// --- Pages ---------------------------------------------------------------------------------------
async function startServer() {
  // Réglages Firebase du navigateur (connexion des enseignants seulement), écrits dans la page au démarrage.
  const webConfig: any = { apiKey: appletConfig.apiKey, authDomain: appletConfig.authDomain, projectId, appId: appletConfig.appId };
  if (process.env.USE_FIREBASE_EMULATORS === "1") webConfig.emulators = { authPort: 9099 };
  const configScript = `<script>window.__FIREBASE_CONFIG__=${JSON.stringify(webConfig).replace(/</g, "\\u003c")};</script>`;

  // Le fichier compilé (dist/server.cjs) sert toujours la version de production, même si NODE_ENV n'est pas réglé.
  const isProduction = process.env.NODE_ENV === "production" || /server\.cjs$/.test(process.argv[1] || "");
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const raw = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
        res.status(200).type("html").end(await vite.transformIndexHtml(req.originalUrl, raw.replace("<head>", `<head>${configScript}`)));
      } catch (e) { next(e); }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf8").replace("<head>", `<head>${configScript}`);
    const sendIndex = (_req: Request, res: Response) => { res.setHeader("Cache-Control", "no-cache"); res.type("html").send(indexHtml); };
    app.get(["/", "/index.html"], sendIndex);
    app.use((req, res, next) => (/^\/server\.cjs/.test(req.path) ? res.status(404).end() : next()));
    app.use(express.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Plan de classe IA : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`));
  chiffrerAnciensMdp().catch(e => console.error("Chiffrement des anciens mots de passe :", e));
}

startServer();
