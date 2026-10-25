import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublishedPlan } from '../types';

// Espaces élève et parents : tout passe par le serveur, qui vérifie le mot de passe et ne renvoie
// que le plan de la classe de l'élève (sans mots de passe ni remarques sur les camarades).

export type PortalRole = 'student' | 'parent';

export interface DirectoryPlan {
  id: string;
  teacherId: string;
  className: string;
  period: string;
  isFrozen: boolean;
  isPast: boolean;
  allowStudentSelfPlacement: boolean;
  updatedAt: string;
}

export interface Directory {
  teachers: { id: string; name: string }[];
  plans: DirectoryPlan[];
}

export interface PortalStudent { id: number; name: string; rollNumber?: string }

export interface PortalSession { token: string; planId: string; studentId: number; name: string; teacherId: string; className: string }

export type PortalPlan = PublishedPlan & { myStudentId: number };

async function call<T>(path: string, init: { body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Portal ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    const err: any = new Error('Pas de connexion internet. Vérifie le réseau puis réessaie.');
    err.status = 0;
    throw err;
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) {
    const err: any = new Error(data?.error || `Erreur du serveur (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const fetchDirectory = () => call<Directory>('/api/public/directory');

export const fetchPlanStudents = async (planId: string) =>
  (await call<{ students: PortalStudent[] }>(`/api/public/plan-students?planId=${encodeURIComponent(planId)}`)).students;

export const portalLogin = (body: { planId: string; studentId: number; pin: string; newPin?: string; role: PortalRole }) =>
  call<{ token?: string; needsNewPin?: boolean; student?: { id: number; name: string } }>('/api/portal/login', { body });

export const portalSeat = (token: string, planId: string, location: number | 'bank') =>
  call<{ success: boolean }>('/api/portal/seat', { token, body: { planId, location } });

// La connexion est gardée le temps de l'onglet (sessionStorage) : fermer l'onglet déconnecte.
const sessionKey = (role: PortalRole) => `plan-classe-portal:${role}`;

export function loadPortalSession(role: PortalRole): PortalSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(role));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function savePortalSession(role: PortalRole, s: PortalSession | null) {
  try {
    if (s) sessionStorage.setItem(sessionKey(role), JSON.stringify(s));
    else sessionStorage.removeItem(sessionKey(role));
  } catch { /* stockage indisponible */ }
}

/**
 * Plan de l'élève connecté, redemandé toutes les quelques secondes pour suivre en direct
 * les changements de l'enseignant et des camarades (seulement quand la page est visible).
 */
export function usePortalPlan(session: PortalSession | null, onExpired: () => void, everyMs = 4000) {
  const [plan, setPlan] = useState<PortalPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const since = useRef<string>('');
  const expired = useRef(onExpired);
  expired.current = onExpired;

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const q = `planId=${encodeURIComponent(session.planId)}${since.current ? `&since=${encodeURIComponent(since.current)}` : ''}`;
      const r = await call<{ unchanged?: boolean; plan?: PortalPlan }>(`/api/portal/plan?${q}`, { token: session.token });
      if (r.plan) {
        since.current = r.plan.updatedAt || '';
        setPlan(r.plan);
      }
      setError(null);
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) expired.current();
      else setError(e.message);
    }
  }, [session]);

  useEffect(() => {
    since.current = '';
    setPlan(null);
    setError(null);
    if (!session) return;
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, everyMs);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [session, refresh, everyMs]);

  return { plan, error, refresh };
}
