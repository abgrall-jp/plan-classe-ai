import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { initializeApp as initAdminApp, getApps as getAdminApps, cert } from "firebase-admin/app";
import { getAuth as getAdminAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, FieldValue, type DocumentData } from "firebase-admin/firestore";
import Stripe from "stripe";
import { type BillingConfig, DEFAULT_BILLING_CONFIG, packBreakdown, sanitizeBillingConfig } from "./lib/billing";

// ---------------------------------------------------------------------------
// Serveur du Plan de Classe IA (hébergement o2switch, hors d'AI Studio).
// Réglages (variables d'environnement, par exemple dans cPanel > Setup Node.js App)
//   GEMINI_API_KEY            clé de l'API Gemini (jamais envoyée au navigateur)
//   FIREBASE_SERVICE_ACCOUNT  clé JSON d'un compte de service du projet Firebase
//                             (ou fichier service-account.json à côté de l'application)
//   FIRESTORE_DATABASE_ID     base Firestore utilisée (sinon celle de firebase-applet-config.json)
//   AI_MODEL / AI_FALLBACK_MODEL  modèle principal et modèle de secours en cas de surcharge
//   ADMIN_EMAILS              adresses des administrateurs, séparées par des virgules
//   STRIPE_SECRET_KEY         clé secrète Stripe (paiement des crédits IA)
//   STRIPE_WEBHOOK_SECRET     secret de signature du webhook Stripe (facultatif)
//   PORTAL_SECRET             secret des connexions élève et parent (sinon tiré de la clé du compte de service)
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;

function readJsonFile(fileName: string): any {
  try {
    const filePath = path.join(process.cwd(), fileName);
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

const adminApp = getAdminApps()[0] || initAdminApp({
  projectId,
  ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
});
const adminAuth = getAdminAuth(adminApp);
const adminDb = databaseId === "(default)" ? getAdminFirestore(adminApp) : getAdminFirestore(adminApp, databaseId);

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "alimatlea@gmail.com")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const APP_VERSION = "2026-10-20.4";
const PLANS = "publishedPlans";
const SECRETS = "planSecrets";
const TEACHERS = "teachers";
const PHOTOS = "studentPhotos";

// --- Gemini ----------------------------------------------------------------
const AI_MODEL = process.env.AI_MODEL || "gemini-3.8-flash";
const AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
// Réglages de génération que le navigateur peut transmettre (pas d'outils, pas de choix de modèle).
const ALLOWED_CONFIG_KEYS = ["systemInstruction", "responseMimeType", "responseSchema", "thinkingConfig", "temperature", "topP", "topK", "maxOutputTokens"];

let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      // GEMINI_BASE_URL sert uniquement aux tests (faux service Gemini local).
      ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
    });
  }
  return aiClient;
}

function isOverload(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = Number(err?.status || err?.code || 0);
  return [429, 500, 503, 504].includes(status) || msg.includes("overloaded") || msg.includes("unavailable") || msg.includes("resource_exhausted") || msg.includes("quota");
}

// --- Petits outils -----------------------------------------------------------
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 300 && !v.includes("/") && v !== "." && v !== "..";
}

function clientIp(req: Request): string {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "?";
}

/** Limiteur en mémoire : au plus `max` appels par fenêtre de `windowMs` pour une même clé. */
function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 50000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    h.count++;
    return h.count <= max;
  };
}

const loginLimiter = makeLimiter(10, 15 * 60 * 1000);
const publicLimiter = makeLimiter(240, 60 * 1000);
const seatLimiter = makeLimiter(60, 60 * 1000);
const aiTeacherLimiter = makeLimiter(Number(process.env.AI_MAX_PER_TEACHER_15MIN) || 300, 15 * 60 * 1000);

/** Nom ou classe sans accents, casse ni espaces superflus (comparaisons). */
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const planClasses = (className: unknown) => String(className || "").split(",").map(norm).filter(Boolean);

// --- Enseignants (compte Firebase avec adresse e-mail) ----------------------------------
type Caller = DecodedIdToken;

async function readCaller(req: Request): Promise<Caller | null> {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return await adminAuth.verifyIdToken(h.slice(7).trim()); } catch { return null; }
}

function isAdminEmail(t: Caller): boolean {
  return !!t.email && t.email_verified === true && ADMIN_EMAILS.includes(t.email.toLowerCase());
}

function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const t = await readCaller(req);
    if (!t) return res.status(401).json({ error: "Connexion requise." });
    if (!isAdminEmail(t)) return res.status(403).json({ error: "Réservé à l'administrateur." });
    (req as any).caller = t;
    next();
  };
}

/** Enseignant : tout compte Firebase avec une adresse e-mail (l'inscription est libre, comme dans la version AI Studio). */
function requireTeacher() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const t = await readCaller(req);
    if (!t) return res.status(401).json({ error: "Connexion requise. Reconnectez-vous puis réessayez." });
    if (!t.email) return res.status(403).json({ error: "Réservé aux enseignants." });
    (req as any).caller = t;
    next();
  };
}

// --- Jetons de l'espace élève et de l'espace parents -------------------------------------
// Les élèves et les parents n'ont pas de compte : après vérification du mot de passe, le serveur
// leur donne un jeton signé qui ouvre les plans de leur enseignant pour leur classe, et rien d'autre.
const PORTAL_SECRET = process.env.PORTAL_SECRET
  || crypto.createHash("sha256").update(`plan-classe:${serviceAccount?.private_key || projectId || "local"}`).digest("hex");

interface PortalToken { r: "student" | "parent"; t: string; c: string[]; n: string; exp: number }

function signPortal(p: PortalToken): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = crypto.createHmac("sha256", PORTAL_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readPortal(req: Request): PortalToken | null {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Portal ") ? h.slice(7).trim() : "";
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", PORTAL_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PortalToken;
    if (!p || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

// --- Plans : lecture avec mise en cache (écoute en temps réel côté serveur) ---------------
// Chaque élève redemande son plan toutes les quelques secondes : le serveur garde la dernière version
// de chaque plan consulté et la tient à jour, sans relire la base à chaque demande.
interface CachedPlan { plan: DocumentData | null; secret: DocumentData | null; ready: Promise<void>; unsub: () => void; lastUse: number }
const planCache = new Map<string, CachedPlan>();

function watchPlan(planId: string): CachedPlan {
  const hit = planCache.get(planId);
  if (hit) { hit.lastUse = Date.now(); return hit; }
  let resolvePlan!: () => void, resolveSecret!: () => void;
  const entry: CachedPlan = {
    plan: null, secret: null, lastUse: Date.now(), unsub: () => {},
    ready: Promise.all([new Promise<void>(r => (resolvePlan = r)), new Promise<void>(r => (resolveSecret = r))]).then(() => {}),
  };
  const u1 = adminDb.doc(`${PLANS}/${planId}`).onSnapshot(s => { entry.plan = s.exists ? s.data()! : null; resolvePlan(); },
    e => { console.error("plan", planId, e.message); resolvePlan(); });
  const u2 = adminDb.doc(`${SECRETS}/${planId}`).onSnapshot(s => { entry.secret = s.exists ? s.data()! : null; resolveSecret(); },
    e => { console.error("secret", planId, e.message); resolveSecret(); });
  entry.unsub = () => { u1(); u2(); };
  planCache.set(planId, entry);
  return entry;
}

setInterval(() => {
  const limit = Date.now() - 10 * 60 * 1000;
  for (const [id, e] of planCache) if (e.lastUse < limit) { e.unsub(); planCache.delete(id); }
}, 60 * 1000).unref();

async function getPlan(planId: string): Promise<{ plan: DocumentData | null; secret: DocumentData | null }> {
  const e = watchPlan(planId);
  await e.ready;
  return { plan: e.plan, secret: e.secret };
}

const placementsOf = (plan: DocumentData | null): any[] => {
  const raw = plan?.placements;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).filter(Boolean);
  return [];
};

const passwordEntry = (secret: DocumentData | null, plan: DocumentData | null, studentId: unknown) => {
  const fromSecret = secret?.studentPasswords?.[String(studentId)];
  const legacy = plan?.studentPasswords?.[String(studentId)];
  const e = fromSecret || legacy || { password: "0000", isDefault: true };
  return { password: String(e.password || "0000"), isDefault: e.isDefault !== false };
};

/** Le jeton ouvre-t-il ce plan ? Même enseignant, une classe commune, et l'élève figure dans le plan. */
function portalStudentIn(tok: PortalToken, plan: DocumentData | null): any | null {
  if (!plan || String(plan.teacherId || "") !== tok.t) return null;
  if (!planClasses(plan.className).some(c => tok.c.includes(c))) return null;
  return placementsOf(plan).find(p => norm(p.name) === tok.n) || null;
}

/** Remarques de l'enseignant pour un élève (seulement les siennes). */
function remarksFor(secret: DocumentData | null, plan: DocumentData | null, student: any): any[] {
  const all = secret?.studentRemarks || plan?.studentRemarks || {};
  const keys = [String(student.name || "").trim().toLowerCase(), `id_${student.id}`, String(student.id)];
  for (const k of keys) if (Array.isArray(all[k])) return all[k];
  return [];
}

const teacherNames = new Map<string, { name: string; at: number }>();
async function teacherDisplayName(teacherId: string, fallback: string): Promise<string> {
  const hit = teacherNames.get(teacherId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.name || fallback;
  let name = "";
  try {
    const t = (await adminDb.doc(`${TEACHERS}/${teacherId}`).get()).data();
    name = [t?.firstName, t?.lastName].filter(Boolean).join(" ").trim();
  } catch { /* ignore */ }
  teacherNames.set(teacherId, { name, at: Date.now() });
  return name || fallback;
}

/** Plan tel que le voit un élève ou un parent : ni mots de passe, ni remarques des autres élèves. */
async function portalView(planId: string, plan: DocumentData, secret: DocumentData | null, me: any) {
  return {
    id: planId,
    teacherId: String(plan.teacherId || ""),
    teacherName: await teacherDisplayName(String(plan.teacherId || ""), String(plan.teacherName || "")),
    className: String(plan.className || ""),
    period: String(plan.period || ""),
    isFrozen: plan.isFrozen === true,
    isPast: plan.isPast === true || plan.isPastPlan === true,
    allowStudentSelfPlacement: plan.allowStudentSelfPlacement === true,
    gridDimensions: plan.gridDimensions || { rows: 5, cols: 6 },
    unavailableCells: Array.isArray(plan.unavailableCells) ? plan.unavailableCells : [],
    cellObstacles: plan.cellObstacles || {},
    placements: placementsOf(plan).map(p => ({
      id: p.id, name: String(p.name || ""), ...(p.rollNumber ? { rollNumber: String(p.rollNumber) } : {}),
      ...(p.photoUrl ? { photoUrl: String(p.photoUrl) } : {}), location: p.location ?? "bank",
    })),
    studentRemarks: { [String(me.name || "").trim().toLowerCase()]: remarksFor(secret, plan, me) },
    myStudentId: me.id,
    updatedAt: String(plan.updatedAt || ""),
  };
}

// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", true);

// --- Stripe ---------------------------------------------------------------------
// Le même compte Stripe sert aussi aux autres applications : les paiements de celle-ci sont marqués
// app « planclasse » et kind « planclasse_credits », et ceux des autres sont ignorés ici.
const STRIPE_APP = "planclasse";
const STRIPE_KIND = "planclasse_credits";
const isAppPayment = (meta: Record<string, string> | null | undefined) => meta?.app === STRIPE_APP && meta?.kind === STRIPE_KIND;

let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  if (!stripeClient) {
    // STRIPE_API_HOST (ex. 127.0.0.1:12111) ne sert qu'aux tests locaux avec un faux serveur Stripe.
    const testHost = process.env.STRIPE_API_HOST;
    stripeClient = testHost
      ? new Stripe(key, { host: testHost.split(":")[0], port: Number(testHost.split(":")[1] || 80), protocol: "http" })
      : new Stripe(key);
  }
  return stripeClient;
}

// Le webhook a besoin du corps brut pour vérifier la signature : il est déclaré avant la lecture JSON.
// Facultatif : les crédits sont aussi ajoutés au retour de la page de paiement (/api/billing/confirm).
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: "Webhook Stripe non configuré." });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, String(req.headers["stripe-signature"] || ""), secret);
  } catch {
    return res.status(400).json({ error: "Signature Stripe invalide." });
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isAppPayment(session.metadata)) {
      try {
        await applyCreditPayment(session);
      } catch (err) {
        console.error("Stripe webhook credit error:", err);
        return res.status(500).json({ error: "Erreur d'enregistrement du crédit." });
      }
    }
  }
  return res.json({ received: true });
});

app.use(express.json({ limit: "25mb" }));

app.get("/api/health", async (req, res) => {
  if (req.query.db === undefined) return res.json({ status: "ok" });
  // Diagnostic d'installation : la clé du serveur est-elle trouvée, et la base répond-elle ?
  const cle = process.env.FIREBASE_SERVICE_ACCOUNT ? "variable FIREBASE_SERVICE_ACCOUNT" : serviceAccount ? "fichier service-account.json" : "introuvable";
  try {
    const [plans, teachers] = await Promise.all([
      adminDb.collection(PLANS).select("teacherId", "className").get(),
      adminDb.collection(TEACHERS).select().get(),
    ]);
    const known = new Set(teachers.docs.map(d => d.id));
    const ids = plans.docs.map(d => String(d.data().teacherId || ""));
    res.json({
      status: "ok", version: APP_VERSION, cle, base: databaseId, acces: "ok",
      plans: plans.size,
      plansSansEnseignant: ids.filter(id => !id).length,
      plansEnseignantInconnu: ids.filter(id => id && !known.has(id)).length,
      enseignants: teachers.size,
    });
  } catch (e: any) {
    res.json({ status: "erreur", version: APP_VERSION, cle, base: databaseId, dossier: process.cwd(), acces: String(e?.message || e).slice(0, 300) });
  }
});

// --- Annuaire des espaces élève et parents -------------------------------------------------
// Enseignants, classes et périodes publiées, sans aucun nom d'élève ni mot de passe.
let directoryCache: { at: number; data: any } | null = null;
app.get("/api/public/directory", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  try {
    if (!directoryCache || Date.now() - directoryCache.at > 20 * 1000) {
      const snap = await adminDb.collection(PLANS)
        .select("teacherId", "teacherName", "className", "period", "isFrozen", "isPast", "isPastPlan", "allowStudentSelfPlacement", "updatedAt")
        .get();
      const plans = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as any)
        .filter(p => p.teacherId && p.className);
      const teacherIds = Array.from(new Set(plans.map(p => String(p.teacherId))));
      const teachers = await Promise.all(teacherIds.map(async id => {
        const fallback = String(plans.find(p => p.teacherId === id)?.teacherName || "Enseignant");
        return { id, name: await teacherDisplayName(id, fallback) };
      }));
      directoryCache = {
        at: Date.now(),
        data: {
          teachers: teachers.sort((a, b) => a.name.localeCompare(b.name, "fr")),
          plans: plans.map(p => ({
            id: p.id, teacherId: String(p.teacherId), className: String(p.className), period: String(p.period || ""),
            isFrozen: p.isFrozen === true, isPast: p.isPast === true || p.isPastPlan === true,
            allowStudentSelfPlacement: p.allowStudentSelfPlacement === true, updatedAt: String(p.updatedAt || ""),
          })),
        },
      };
    }
    res.json(directoryCache.data);
  } catch (e: any) {
    console.error("public/directory", e);
    res.status(500).json({ error: "Erreur lors du chargement des classes." });
  }
});

// Noms des élèves d'un plan (écran de connexion), jamais les mots de passe ni les places.
app.get("/api/public/plan-students", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  const planId = String(req.query.planId || "");
  if (!isSafeId(planId)) return res.json({ students: [] });
  try {
    const { plan } = await getPlan(planId);
    const students = placementsOf(plan)
      .map(p => ({ id: p.id, name: String(p.name || ""), ...(p.rollNumber ? { rollNumber: String(p.rollNumber) } : {}) }))
      .filter(s => s.name)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ students });
  } catch (e: any) {
    console.error("public/plan-students", e);
    res.status(500).json({ error: "Erreur lors du chargement des élèves." });
  }
});

// --- Connexion élève et parent ------------------------------------------------------------
// Mêmes règles que la version AI Studio : « 0000 » (ou le mot de passe donné par l'enseignant),
// puis choix obligatoire d'un mot de passe personnel. Vérifié ici, plus dans le navigateur.
// Le nouveau mot de passe est recopié dans tous les plans de la classe (autres périodes) de cet enseignant.
app.post("/api/portal/login", async (req, res) => {
  const planId = String(req.body?.planId || "");
  const studentId = req.body?.studentId;
  const pin = String(req.body?.pin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();
  const role: "student" | "parent" = req.body?.role === "parent" ? "parent" : "student";
  if (!isSafeId(planId) || studentId === undefined || studentId === null) {
    return res.status(400).json({ error: "Choisis d'abord ta classe et ton nom dans la liste." });
  }
  if (!loginLimiter(`login:${clientIp(req)}:${planId}:${studentId}`)) {
    return res.status(429).json({ error: "Trop d'essais. Réessaie dans 15 minutes." });
  }
  try {
    const { plan, secret } = await getPlan(planId);
    const student = placementsOf(plan).find(p => String(p.id) === String(studentId));
    if (!plan || !student || !plan.teacherId) return res.status(404).json({ error: "Élève introuvable. Demande à ton enseignant." });
    const entry = passwordEntry(secret, plan, student.id);
    if (!pin || pin !== entry.password) {
      return res.status(403).json({
        error: entry.isDefault
          ? "Mot de passe incorrect. Pour la première connexion, c'est « 0000 » ou celui donné par ton enseignant."
          : "Mot de passe incorrect. En cas d'oubli, ton enseignant peut le remettre à zéro.",
      });
    }
    if (entry.isDefault || entry.password === "0000") {
      if (!newPin) return res.json({ needsNewPin: true });
      if (newPin.length < 4) return res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caractères." });
      if (newPin === "0000" || newPin === entry.password) return res.status(400).json({ error: "Choisis un mot de passe personnel, différent du mot de passe de départ." });
      await setPasswordEverywhere(String(plan.teacherId), planClasses(plan.className), String(student.name), newPin);
    }
    const token = signPortal({
      r: role,
      t: String(plan.teacherId),
      c: planClasses(plan.className),
      n: norm(student.name),
      exp: Date.now() + (role === "parent" ? 30 : 1) * 24 * 3600 * 1000,
    });
    res.json({ token, student: { id: student.id, name: String(student.name) } });
  } catch (e: any) {
    console.error("portal/login", e);
    res.status(500).json({ error: "Erreur de connexion. Réessaie." });
  }
});

/** Recopie un mot de passe personnel dans tous les plans de l'enseignant pour cette classe (toutes les périodes). */
async function setPasswordEverywhere(teacherId: string, classes: string[], studentName: string, newPin: string) {
  const plans = await adminDb.collection(PLANS).where("teacherId", "==", teacherId).get();
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  for (const d of plans.docs) {
    const p = d.data();
    if (!planClasses(p.className).some(c => classes.includes(c))) continue;
    const st = placementsOf(p).find(x => norm(x.name) === norm(studentName));
    if (!st) continue;
    batch.set(adminDb.doc(`${SECRETS}/${d.id}`), {
      teacherId,
      studentPasswords: { [String(st.id)]: { password: newPin, isDefault: false, updatedAt: now } },
    }, { merge: true });
  }
  await batch.commit();
}

// Plan de l'élève ou du parent connecté (redemandé régulièrement pour suivre les changements en direct).
app.get("/api/portal/plan", async (req, res) => {
  const tok = readPortal(req);
  if (!tok) return res.status(401).json({ error: "Connexion expirée : reconnecte-toi." });
  const planId = String(req.query.planId || "");
  if (!isSafeId(planId)) return res.status(400).json({ error: "Plan introuvable." });
  try {
    const { plan, secret } = await getPlan(planId);
    const me = portalStudentIn(tok, plan);
    if (!plan || !me) return res.status(403).json({ error: "Ce plan n'est pas celui de ta classe." });
    if (req.query.since && String(req.query.since) === String(plan.updatedAt || "")) return res.json({ unchanged: true });
    res.json({ plan: await portalView(planId, plan, secret, me), role: tok.r });
  } catch (e: any) {
    console.error("portal/plan", e);
    res.status(500).json({ error: "Erreur lors du chargement du plan." });
  }
});

// Choix de sa place par l'élève (si l'enseignant l'autorise et n'a pas figé le plan).
app.post("/api/portal/seat", async (req, res) => {
  const tok = readPortal(req);
  if (!tok || tok.r !== "student") return res.status(401).json({ error: "Connexion élève requise." });
  if (!seatLimiter(`seat:${tok.t}:${tok.n}`)) return res.status(429).json({ error: "Trop de changements de place. Patiente une minute." });
  const planId = String(req.body?.planId || "");
  const loc = req.body?.location;
  const newLocation: number | "bank" = loc === "bank" ? "bank" : Number(loc);
  if (!isSafeId(planId) || (newLocation !== "bank" && (!Number.isInteger(newLocation) || newLocation < 0))) {
    return res.status(400).json({ error: "Place invalide." });
  }
  try {
    const ref = adminDb.doc(`${PLANS}/${planId}`);
    const result = await adminDb.runTransaction(async tx => {
      const plan = (await tx.get(ref)).data() || null;
      const me = portalStudentIn(tok, plan);
      if (!plan || !me) return { status: 403, error: "Ce plan n'est pas celui de ta classe." };
      if (plan.isFrozen) return { status: 409, error: "Ce plan est figé par l'enseignant : les places ne peuvent plus changer." };
      if (!plan.allowStudentSelfPlacement) return { status: 409, error: "Le choix libre des places est désactivé par l'enseignant." };
      const rows = Number(plan.gridDimensions?.rows) || 5, cols = Number(plan.gridDimensions?.cols) || 6;
      if (newLocation !== "bank") {
        if (newLocation >= rows * cols) return { status: 400, error: "Place invalide." };
        if ((plan.unavailableCells || []).includes(newLocation)) return { status: 409, error: "Cet emplacement n'est pas une place." };
      }
      const list = placementsOf(plan).map(p => ({ ...p }));
      const mine = list.find(p => String(p.id) === String(me.id))!;
      const previous = mine.location;
      if (newLocation !== "bank") {
        const occupant = list.find(p => p.location === newLocation && String(p.id) !== String(me.id));
        // Une place déjà prise par un camarade n'est pas échangée : l'élève choisit une place libre.
        if (occupant) return { status: 409, error: `Cette place est déjà prise par ${occupant.name}.` };
      }
      mine.location = newLocation;
      const updatedAt = new Date().toISOString();
      tx.update(ref, { placements: list, updatedAt });
      return { status: 200, previous, updatedAt };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  } catch (e: any) {
    console.error("portal/seat", e);
    res.status(500).json({ error: "Erreur d'enregistrement de la place." });
  }
});

// --- IA -------------------------------------------------------------------------
// Seuls les enseignants utilisent l'IA (liste d'élèves irrégulière, trombinoscope).
app.post("/api/ai/generate", requireTeacher(), async (req, res) => {
  const t = (req as any).caller as Caller;
  if (!aiTeacherLimiter(`t:${t.uid}`)) return res.status(429).json({ code: "QUOTA_EXCEEDED", error: "Trop de demandes à l'IA en peu de temps. Patientez quelques minutes." });
  const genAI = getAI();
  if (!genAI) return res.status(500).json({ error: "Clé GEMINI_API_KEY non configurée sur le serveur." });

  const { contents, config } = req.body || {};
  if (!contents) return res.status(400).json({ error: "Demande vide." });

  // Crédits IA : réservé avant l'appel, rendu si l'appel échoue.
  const credit = await reserveCredit(t);
  if (!credit) {
    return res.status(402).json({
      code: "NO_CREDIT",
      error: "Votre crédit IA est épuisé. Rechargez-le avec le bouton « Crédits IA » de l'Espace Enseignant.",
    });
  }
  res.on("finish", () => { if (res.statusCode >= 400) credit.refund(); });
  const finalConfig: Record<string, unknown> = {};
  if (config && typeof config === "object") {
    for (const k of ALLOWED_CONFIG_KEYS) if (k in config) finalConfig[k] = config[k];
  }
  const chain = Array.from(new Set([AI_MODEL, AI_FALLBACK_MODEL]));

  let lastError: any = null;
  for (const candidate of chain) {
    try {
      const r = await genAI.models.generateContent({
        model: candidate,
        contents,
        config: Object.keys(finalConfig).length > 0 ? finalConfig : undefined,
      });
      if (typeof r?.text === "string") return res.json({ text: r.text, modelUsed: candidate });
    } catch (err: any) {
      lastError = err;
      console.warn(`[IA] échec avec ${candidate} : ${err?.message || err}`);
      // Une erreur qui n'est pas une surcharge (demande invalide...) ne se règle pas en changeant de modèle.
      if (!isOverload(err)) break;
    }
  }
  const msg = String(lastError?.message || lastError || "");
  if (msg.includes("prepayment credits") || lastError?.status === 402) {
    return res.status(402).json({ code: "CREDITS_DEPLETED", error: "Crédits Google épuisés : prévenez l'administrateur." });
  }
  if (isOverload(lastError)) {
    return res.status(429).json({ code: "QUOTA_EXCEEDED", error: "L'IA est très demandée en ce moment. Réessayez dans une minute." });
  }
  res.status(500).json({ error: "Erreur lors de la génération IA." });
});

// --- Crédits IA payants (comme dans les autres applications) ------------------------
// Un crédit = un appel à l'IA. L'enseignant paie ses propres appels.
let billingConfigCache: { cfg: BillingConfig; at: number } | null = null;

async function getBillingConfig(): Promise<BillingConfig> {
  if (billingConfigCache && Date.now() - billingConfigCache.at < 30_000) return billingConfigCache.cfg;
  const snap = await adminDb.doc("appConfig/billing").get();
  const cfg = snap.exists ? sanitizeBillingConfig(snap.data()) : DEFAULT_BILLING_CONFIG;
  billingConfigCache = { cfg, at: Date.now() };
  return cfg;
}

/** Ajoute une seule fois les crédits d'un paiement Stripe réussi. */
async function applyCreditPayment(session: Stripe.Checkout.Session): Promise<{ applied: boolean; credits: number; teacherId: string }> {
  const meta = session.metadata || {};
  const teacherId = String(meta.teacherId || "");
  const credits = parseInt(String(meta.credits || "0"), 10);
  if (!isAppPayment(meta) || !isSafeId(teacherId) || !(credits > 0)) {
    throw new Error("Ce paiement n'est pas une recharge de crédits du Plan de Classe IA.");
  }
  if (session.payment_status !== "paid") return { applied: false, credits: 0, teacherId };
  const cfg = await getBillingConfig();
  const ref = adminDb.doc(`billing/${teacherId}`);
  const payRef = adminDb.doc(`billing/${teacherId}/payments/${session.id}`);
  const applied = await adminDb.runTransaction(async tx => {
    const pay = await tx.get(payRef);
    if (pay.exists) return false;
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
    tx.set(ref, {
      credits: current + credits,
      purchased: FieldValue.increment(credits),
      updatedAt: Date.now(),
      ...(snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() }),
    }, { merge: true });
    tx.set(payRef, { credits, amountEur: (session.amount_total || 0) / 100, at: Date.now() });
    return true;
  });
  return { applied, credits, teacherId };
}

/**
 * Ajoute les recharges payées des 30 derniers jours jamais créditées, en interrogeant Stripe.
 * Couvre un professeur qui a fermé la page avant de revenir, ou un webhook absent.
 */
const lastStripeSync = new Map<string, number>();
async function syncStripePayments(teacherId: string | null): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  const key = teacherId || "*";
  const now = Date.now();
  if (now - (lastStripeSync.get(key) || 0) < 20000) return;
  lastStripeSync.set(key, now);
  try {
    const since = Math.floor(now / 1000) - 30 * 24 * 3600;
    for await (const session of stripe.checkout.sessions.list({ created: { gte: since }, status: "complete", limit: 100 })) {
      const meta = session.metadata || {};
      if (!isAppPayment(meta) || session.payment_status !== "paid") continue;
      if (teacherId && meta.teacherId !== teacherId) continue;
      await applyCreditPayment(session).catch(err => console.error("Credit sync error:", err?.message));
    }
  } catch (err: any) {
    console.error("Stripe payments sync error:", err?.message);
  }
}

/** Réserve un crédit avant l'appel à l'IA. Renvoie une fonction de remboursement, ou null si le crédit est épuisé. */
async function reserveCredit(t: Caller): Promise<{ refund: () => void } | null> {
  const noop = { refund: () => {} };
  try {
    const cfg = await getBillingConfig();
    if (!cfg.enabled) return noop;
    if (cfg.adminsExempt && isAdminEmail(t)) return noop;
    const ref = adminDb.doc(`billing/${t.uid}`);
    const reserved = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const credits = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
      if (credits < 1) return false;
      tx.set(ref, {
        credits: credits - 1,
        used: FieldValue.increment(1),
        updatedAt: Date.now(),
        ...(snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() }),
      }, { merge: true });
      return true;
    });
    if (!reserved) return null;
    return {
      refund: () => {
        ref.set({ credits: FieldValue.increment(1), used: FieldValue.increment(-1) }, { merge: true })
          .catch(err => console.error("AI credit refund error:", err));
      },
    };
  } catch (err) {
    // Un souci de facturation ne doit jamais bloquer un enseignant : l'appel passe et l'erreur est notée.
    console.error("AI credit check error:", err);
    return noop;
  }
}

// Solde, recharges et détail des frais pour l'enseignant connecté.
app.get("/api/billing/me", requireTeacher(), async (req, res) => {
  const t = (req as any).caller as Caller;
  try {
    const cfg = await getBillingConfig();
    if (cfg.enabled) await syncStripePayments(t.uid);
    let credits = cfg.freeCredits, used = 0;
    const snap = await adminDb.doc(`billing/${t.uid}`).get();
    if (snap.exists) {
      credits = Number(snap.data()?.credits || 0);
      used = Number(snap.data()?.used || 0);
    }
    res.json({
      enabled: cfg.enabled,
      exempt: cfg.adminsExempt && isAdminEmail(t),
      isAdmin: isAdminEmail(t),
      credits,
      used,
      pricePerCorrectionEur: cfg.pricePerCorrectionEur,
      stripeFixedEur: cfg.stripeFixedEur,
      stripePercent: cfg.stripePercent,
      packs: cfg.packsEur.map(eur => packBreakdown(eur, cfg)),
      paymentConfigured: !!getStripe(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur de lecture du crédit." });
  }
});

app.post("/api/billing/checkout", requireTeacher(), async (req, res) => {
  const t = (req as any).caller as Caller;
  const cfg = await getBillingConfig();
  const eur = Number(req.body?.eur);
  if (!cfg.packsEur.includes(eur)) return res.status(400).json({ error: "Montant de recharge inconnu." });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Le paiement en ligne n'est pas encore configuré." });
  const pack = packBreakdown(eur, cfg);
  try {
    const origin = req.headers.origin || process.env.APP_URL || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `Plan de Classe IA : ${pack.corrections} crédits IA`,
            description: `Recharge de ${eur} € (dont ${pack.stripeFeeEur.toFixed(2)} € de frais de paiement)`,
          },
          unit_amount: Math.round(eur * 100),
        },
        quantity: 1,
      }],
      customer_email: t.email || undefined,
      success_url: `${origin}/?credits_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?credits_cancelled=true`,
      metadata: { app: STRIPE_APP, kind: STRIPE_KIND, teacherId: t.uid, credits: String(pack.corrections), eur: String(eur) },
    });
    res.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe credits checkout error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de la création du paiement." });
  }
});

// Retour de la page de paiement : le paiement est vérifié auprès de Stripe, jamais d'après l'adresse.
app.post("/api/billing/confirm", requireTeacher(), async (req, res) => {
  const t = (req as any).caller as Caller;
  const sessionId = String(req.body?.sessionId || "");
  const stripe = getStripe();
  if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: "Paiement introuvable." });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.teacherId !== t.uid && !isAdminEmail(t)) {
      return res.status(403).json({ error: "Ce paiement appartient à un autre compte." });
    }
    const result = await applyCreditPayment(session);
    res.json({ success: true, paid: session.payment_status === "paid", ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur de vérification du paiement." });
  }
});

app.get("/api/admin/billing", requireAdmin(), async (_req, res) => {
  try {
    billingConfigCache = null;
    const cfg = await getBillingConfig();
    await syncStripePayments(null);
    const [teachersSnap, billingSnap] = await Promise.all([
      adminDb.collection(TEACHERS).get(),
      adminDb.collection("billing").get(),
    ]);
    const balances = new Map(billingSnap.docs.map(d => [d.id, d.data()]));
    const teachers = teachersSnap.docs
      .map(d => {
        const b: any = balances.get(d.id);
        const u = d.data() || {};
        return {
          teacherId: d.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || d.id,
          email: u.email || "",
          credits: b ? Number(b.credits || 0) : null,
          used: b ? Number(b.used || 0) : 0,
          purchased: b ? Number(b.purchased || 0) : 0,
        };
      })
      .sort((a, b) => b.used - a.used || String(a.name).localeCompare(String(b.name)));
    res.json({ config: cfg, teachers, paymentConfigured: !!getStripe() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur de lecture." });
  }
});

app.post("/api/admin/billing/config", requireAdmin(), async (req, res) => {
  try {
    const cfg = sanitizeBillingConfig(req.body?.config);
    await adminDb.doc("appConfig/billing").set({ ...cfg, updatedAt: Date.now() });
    billingConfigCache = { cfg, at: Date.now() };
    res.json({ success: true, config: cfg });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur d'enregistrement." });
  }
});

app.post("/api/admin/billing/grant", requireAdmin(), async (req, res) => {
  const teacherId = String(req.body?.teacherId || "");
  const credits = Math.round(Number(req.body?.credits));
  if (!isSafeId(teacherId) || !Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 100000) {
    return res.status(400).json({ error: "Nombre de crédits invalide." });
  }
  try {
    const cfg = await getBillingConfig();
    const ref = adminDb.doc(`billing/${teacherId}`);
    const total = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
      const next = Math.max(0, current + credits);
      tx.set(ref, { credits: next, updatedAt: Date.now(), ...(snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() }) }, { merge: true });
      return next;
    });
    res.json({ success: true, credits: total });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur d'enregistrement." });
  }
});

// Plans sans propriétaire (anciens plans) : liste et rattachement à un enseignant par l'administrateur.
// Sont aussi listés les plans rattachés à un compte qui n'a pas (ou plus) de fiche enseignant.
app.get("/api/admin/orphan-plans", requireAdmin(), async (_req, res) => {
  const [snap, teachers] = await Promise.all([
    adminDb.collection(PLANS).select("teacherName", "className", "period", "teacherId", "updatedAt").get(),
    adminDb.collection(TEACHERS).select().get(),
  ]);
  const known = new Set(teachers.docs.map(d => d.id));
  const plans = snap.docs
    .filter(d => { const id = String(d.data().teacherId || ""); return !id || !known.has(id); })
    .map(d => ({ id: d.id, ...d.data() }) as any);
  // Comptes qui ont publié des plans mais n'ont pas de fiche enseignant (anciens comptes AI Studio).
  const accounts = new Map<string, string>();
  for (const p of plans) if (p.teacherId && !accounts.has(p.teacherId)) accounts.set(p.teacherId, String(p.teacherName || "Enseignant"));
  res.json({ plans, accountsWithoutProfile: Array.from(accounts, ([id, name]) => ({ id, name })) });
});

// Crée la fiche enseignant d'un compte qui n'en a pas, à partir du nom écrit sur ses plans.
app.post("/api/admin/create-profile", requireAdmin(), async (req, res) => {
  const teacherId = String(req.body?.teacherId || "");
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!isSafeId(teacherId) || !name) return res.status(400).json({ error: "Compte ou nom invalide." });
  const ref = adminDb.doc(`${TEACHERS}/${teacherId}`);
  if ((await ref.get()).exists) return res.status(409).json({ error: "Ce profil existe déjà." });
  const used = await adminDb.collection(PLANS).where("teacherId", "==", teacherId).limit(1).get();
  if (used.empty) return res.status(404).json({ error: "Aucun plan n'est lié à ce compte." });
  const civ = name.match(/^(M\.?|Mme\.?|Mr\.?|Madame|Monsieur)\s+/i);
  const email = String(used.docs[0].data().teacherEmail || "");
  await ref.set({
    uid: teacherId, email,
    firstName: civ ? civ[1] : "", lastName: civ ? name.slice(civ[0].length) : name,
    disciplines: [], classes: [], role: "teacher", updatedAt: new Date().toISOString(),
  });
  teacherNames.delete(teacherId);
  directoryCache = null;
  res.json({ success: true });
});

// Supprime un ancien plan (test, doublon). Les élèves et les parents ne le verront plus.
app.post("/api/admin/delete-plan", requireAdmin(), async (req, res) => {
  const planId = String(req.body?.planId || "");
  if (!isSafeId(planId)) return res.status(400).json({ error: "Plan invalide." });
  await adminDb.doc(`${PLANS}/${planId}`).delete();
  await adminDb.doc(`${SECRETS}/${planId}`).delete();
  directoryCache = null;
  res.json({ success: true });
});

app.post("/api/admin/assign-plan", requireAdmin(), async (req, res) => {
  const planId = String(req.body?.planId || "");
  const teacherId = String(req.body?.teacherId || "");
  if (!isSafeId(planId) || !isSafeId(teacherId)) return res.status(400).json({ error: "Plan ou enseignant invalide." });
  const t = await adminDb.doc(`${TEACHERS}/${teacherId}`).get();
  if (!t.exists) return res.status(404).json({ error: "Enseignant introuvable." });
  await adminDb.doc(`${PLANS}/${planId}`).set({ teacherId, teacherEmail: String(t.data()?.email || "") }, { merge: true });
  await adminDb.doc(`${SECRETS}/${planId}`).set({ teacherId }, { merge: true });
  directoryCache = null;
  res.json({ success: true });
});

app.use("/api", (_req, res) => { res.status(404).json({ error: "Route inconnue." }); });

// --- Reprise des données de la version AI Studio --------------------------------------------
// Lancée à chaque démarrage, sans effet quand tout est déjà à jour (donc aussi après la copie finale) :
//  1. les mots de passe et remarques des élèves quittent le document public du plan (planSecrets) ;
//  2. un plan sans propriétaire est rattaché à son enseignant (adresse e-mail, sinon nom unique) ;
//  3. une photo sans propriétaire est rattachée à l'enseignant dont un plan contient cet élève (s'il est le seul).
async function migrateLegacyData(): Promise<void> {
  const [plansSnap, teachersSnap] = await Promise.all([adminDb.collection(PLANS).get(), adminDb.collection(TEACHERS).get()]);
  const teachers = teachersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const byEmail = new Map(teachers.filter(t => t.email).map(t => [String(t.email).toLowerCase(), t.id]));
  const nameVariants = (t: any) => {
    const f = norm(t.firstName), l = norm(t.lastName);
    if (!l) return [] as string[];
    return [l, `${f} ${l}`, `${l} ${f}`, `m. ${l}`, `m ${l}`, `mme ${l}`, `mme. ${l}`, `mr ${l}`, `madame ${l}`, `monsieur ${l}`].map(v => v.trim());
  };
  const byName = new Map<string, string[]>();
  for (const t of teachers) for (const v of nameVariants(t)) byName.set(v, [...(byName.get(v) || []), t.id]);

  let moved = 0, assigned = 0, unassigned = 0;
  const writer = adminDb.bulkWriter();
  const studentOwners = new Map<string, Set<string>>();
  for (const d of plansSnap.docs) {
    const p = d.data();
    let teacherId = String(p.teacherId || "");
    // Une seule écriture par plan : rattachement à l'enseignant et retrait des secrets.
    const planUpdate: Record<string, unknown> = {};
    if (!teacherId) {
      const viaEmail = p.teacherEmail ? byEmail.get(String(p.teacherEmail).toLowerCase()) : undefined;
      const viaName = byName.get(norm(String(p.teacherName || "").replace(/\(.*?\)/g, "")));
      teacherId = viaEmail || (viaName && new Set(viaName).size === 1 ? viaName[0] : "");
      if (teacherId) { planUpdate.teacherId = teacherId; assigned++; } else unassigned++;
    }
    const secretRef = adminDb.doc(`${SECRETS}/${d.id}`);
    if (p.studentPasswords !== undefined || p.studentRemarks !== undefined) {
      const existing = (await secretRef.get()).data() || {};
      writer.set(secretRef, {
        ...(teacherId ? { teacherId } : {}),
        studentPasswords: { ...(p.studentPasswords || {}), ...(existing.studentPasswords || {}) },
        studentRemarks: { ...(p.studentRemarks || {}), ...(existing.studentRemarks || {}) },
        updatedAt: String(p.updatedAt || ""),
      }, { merge: true });
      planUpdate.studentPasswords = FieldValue.delete();
      planUpdate.studentRemarks = FieldValue.delete();
      moved++;
    } else if (planUpdate.teacherId) {
      writer.set(secretRef, { teacherId }, { merge: true });
    }
    if (Object.keys(planUpdate).length) writer.update(d.ref, planUpdate);
    if (teacherId) for (const s of placementsOf(p)) {
      const k = norm(s.name);
      if (!studentOwners.has(k)) studentOwners.set(k, new Set());
      studentOwners.get(k)!.add(teacherId);
    }
  }

  let photos = 0;
  const photosSnap = await adminDb.collection(PHOTOS).get();
  for (const d of photosSnap.docs) {
    const ph = d.data();
    if (ph.teacherId) continue;
    const owners = studentOwners.get(norm(ph.name || ph.key));
    if (!owners || owners.size !== 1) continue;
    const owner = Array.from(owners)[0];
    const key = String(ph.key || norm(ph.name));
    writer.set(adminDb.doc(`${PHOTOS}/${owner}_${key.replace(/[^a-z0-9]/g, "_")}`), { ...ph, key, teacherId: owner });
    writer.delete(d.ref);
    photos++;
  }
  await writer.close();
  if (moved || assigned || unassigned || photos) {
    console.log(`Reprise des données : ${moved} plan(s) aux mots de passe mis à part, ${assigned} plan(s) rattaché(s), `
      + `${unassigned} plan(s) sans enseignant retrouvé (visibles par l'administrateur), ${photos} photo(s) rattachée(s).`);
  }
}

// --- Pages -----------------------------------------------------------------------
async function startServer() {
  if (process.env.SKIP_MIGRATION !== "1") {
    try { await migrateLegacyData(); } catch (e) { console.error("Reprise des données impossible :", e); }
  }

  // Réglages Firebase du navigateur, écrits dans la page au démarrage : la base peut changer sans recompiler.
  const webConfig: any = { ...appletConfig, ...(readJsonFile("firebase-web-config.json") || {}), firestoreDatabaseId: databaseId };
  delete webConfig.recaptchaSiteKey;
  if (process.env.USE_FIREBASE_EMULATORS === "1") {
    webConfig.emulators = { host: "127.0.0.1", firestorePort: 8080, authPort: 9099 };
    webConfig.projectId = projectId;
  }
  const configScript = `<script>window.__FIREBASE_CONFIG__=${JSON.stringify(webConfig).replace(/</g, "\\u003c")};</script>`;

  // Le fichier compilé (dist/server.cjs) sert toujours la version de production, même si NODE_ENV n'est pas réglé.
  const isProduction = process.env.NODE_ENV === "production" || /server\.cjs$/.test(process.argv[1] || "");
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const raw = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, raw.replace("<head>", `<head>${configScript}`));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) { next(e); }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf8").replace("<head>", `<head>${configScript}`);
    const sendIndex = (_req: Request, res: Response) => { res.setHeader("Cache-Control", "no-cache"); res.type("html").send(indexHtml); };
    app.get(["/", "/index.html"], sendIndex);
    // Le code du serveur (server.cjs) est rangé dans dist/ mais ne doit jamais être téléchargeable.
    app.use((req, res, next) => (/^\/server\.cjs/i.test(req.path) ? res.status(404).end() : next()));
    app.use(express.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Plan de Classe IA : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`);
  });
}

startServer();
