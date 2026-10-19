import { auth } from '../lib/firebase';

// Appels au serveur de l'application (server.ts). Le jeton de connexion Firebase est joint quand il existe.
export async function apiFetch<T = any>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth.currentUser) {
    try { headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`; } catch (_) {}
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err: any = new Error(data?.error || `Erreur du serveur (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data as T;
}

/** Appel à l'IA par le serveur (clé Gemini et modèle fixés côté serveur, crédits décomptés). */
export async function generateAI(contents: unknown, config?: Record<string, unknown>): Promise<string> {
  const r = await apiFetch<{ text: string }>('/api/ai/generate', { contents, config });
  return r.text || '';
}
