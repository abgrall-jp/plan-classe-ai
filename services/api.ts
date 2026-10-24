// Appels au serveur du Plan de classe IA : le navigateur ne parle plus directement à la base.
import { auth } from '../lib/firebase';

const IMPERSONATE_KEY = 'superadmin_impersonate_target_v1';
const SESSION_KEY = 'plan_classe_session_v1';

async function lire(r: Response) {
  let data: any = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data?.error || `Erreur ${r.status}`), { status: r.status });
  return data;
}

/** Un enseignant est connecté avec son compte (pas en mode local hors ligne). */
export const enseignantConnecte = () => !!auth.currentUser;

/** Appel au nom de l'enseignant connecté (ou de l'enseignant que l'administrateur consulte). */
export async function apiEnseignant<T = any>(method: string, chemin: string, body?: unknown, soiMeme = false): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Connexion enseignant requise.'), { status: 401 });
  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}` };
  try {
    const cible = JSON.parse(localStorage.getItem(IMPERSONATE_KEY) || 'null');
    if (!soiMeme && cible?.uid && cible.uid !== user.uid) headers['X-Impersonate'] = cible.uid;
  } catch {}
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return lire(await fetch(chemin, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

// --- Session de l'élève ou du parent ---------------------------------------------------------
export type SessionPortail = { token: string; planId: string; studentId: number; role: 'student' | 'parent' };

export const lireSessionPortail = (): SessionPortail | null => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
export const ecrireSessionPortail = (s: SessionPortail | null) => {
  try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch {}
};

/** Appel public (portail élève et parent), avec le jeton de session s'il y en a un. */
export async function apiPublic<T = any>(method: string, chemin: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const s = lireSessionPortail();
  if (s?.token) headers['X-Session'] = s.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return lire(await fetch(chemin, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}
