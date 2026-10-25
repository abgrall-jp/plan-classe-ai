import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import type { TeacherAccount } from '../services/teacherAuthService';

interface OrphanPlan { id: string; teacherName?: string; className?: string; period?: string; updatedAt?: string; studentCount?: number }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Enseignant le plus probable d'après le nom écrit sur le plan (ex. « M. Abgrall »), sinon l'administrateur.
function guessTeacher(plan: OrphanPlan, teachers: TeacherAccount[], fallbackUid: string): string {
  const name = norm(String(plan.teacherName || ''));
  const hits = teachers.filter(t => t.lastName && name.includes(norm(t.lastName)));
  const withFirst = hits.filter(t => t.firstName && name.includes(norm(t.firstName)));
  return (withFirst[0] || hits.find(t => t.uid === fallbackUid) || hits[0])?.uid || fallbackUid;
}

/**
 * Administrateur : plans repris de l'ancienne application sans enseignant propriétaire.
 * Tant qu'ils ne sont pas rattachés, les élèves et les parents ne peuvent pas les ouvrir.
 */
export default function OrphanPlansPanel({ teachers, currentUid, onTeachersChanged }: {
  teachers: TeacherAccount[];
  currentUid: string;
  onTeachersChanged?: () => void;
}) {
  const [plans, setPlans] = useState<OrphanPlan[] | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => apiFetch<{ plans: OrphanPlan[]; accountsWithoutProfile?: { id: string; name: string }[] }>('/api/admin/orphan-plans')
    .then(r => { setPlans(r.plans || []); setAccounts(r.accountsWithoutProfile || []); })
    .catch(e => setError(e.message));

  useEffect(() => { load(); }, []);

  // Les doublons (même classe, même période) se suivent, le plus récent en premier.
  const dupKey = (p: OrphanPlan) => `${norm(String(p.className || ''))}|${norm(String(p.period || ''))}`;
  const sorted = [...(plans || [])].sort((a, b) =>
    dupKey(a).localeCompare(dupKey(b), 'fr') || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const groupSize = new Map<string, number>();
  sorted.forEach(p => groupSize.set(dupKey(p), (groupSize.get(dupKey(p)) || 0) + 1));
  const formatDate = (iso?: string) => iso
    ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'date inconnue';

  if (!plans || plans.length === 0) return error ? <p className="text-xs text-red-600">{error}</p> : null;

  const teacherFor = (p: OrphanPlan) => choice[p.id] || guessTeacher(p, teachers, currentUid);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const assign = (list: OrphanPlan[]) => run(async () => {
    for (const p of list) await apiFetch('/api/admin/assign-plan', { planId: p.id, teacherId: teacherFor(p) });
  });

  const createProfile = (a: { id: string; name: string }) => {
    const name = window.prompt("Nom de l'enseignant tel qu'il s'affichera pour les élèves :", a.name);
    if (!name || !name.trim()) return;
    run(async () => {
      await apiFetch('/api/admin/create-profile', { teacherId: a.id, name: name.trim() });
      onTeachersChanged?.();
    });
  };

  const remove = (p: OrphanPlan) => {
    if (!window.confirm(`Supprimer définitivement le plan « ${p.className || '?'} · ${p.period || 'sans période'} » ?`)) return;
    run(() => apiFetch('/api/admin/delete-plan', { planId: p.id }));
  };

  return (
    <div className="p-4 rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 space-y-3 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <p className="font-extrabold text-amber-950 dark:text-amber-100 text-sm">
            ⚠️ {plans.length} plan(s) sans enseignant
          </p>
          <p className="text-amber-900 dark:text-amber-200">
            Les élèves et les parents ne les voient pas. Choisissez à qui ils appartiennent puis rattachez-les.
            Un plan de test ou en double peut être supprimé avec 🗑️. Un plan dont l'enseignant n'a pas encore de compte peut attendre ici.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => assign(plans)}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold rounded-xl shadow-xs shrink-0"
        >
          {busy ? 'Rattachement…' : 'Tout rattacher'}
        </button>
      </div>
      {accounts.length > 0 && (
        <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-amber-200 dark:border-amber-800 space-y-2">
          <p className="font-bold text-amber-950 dark:text-amber-100">
            Ces enseignants ont un compte mais pas encore de profil. Créez-le pour pouvoir leur rattacher leurs plans :
          </p>
          <div className="flex flex-wrap gap-2">
            {accounts.map(a => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => createProfile(a)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg"
              >
                ➕ Créer le profil de {a.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {sorted.map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800">
            <span className="font-bold text-slate-900 dark:text-white min-w-0">
              Classe {p.className || '?'} · {p.period || 'sans période'}
            </span>
            <span className="text-slate-500 dark:text-slate-400">écrit « {p.teacherName || 'sans nom'} »</span>
            <span className="text-slate-600 dark:text-slate-300">
              · {p.studentCount ?? 0} élève(s) · modifié le {formatDate(p.updatedAt)}
            </span>
            {(groupSize.get(dupKey(p)) || 0) > 1 && (
              i === 0 || dupKey(sorted[i - 1]) !== dupKey(p) ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold">
                  Doublon : le plus récent
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold">
                  Doublon plus ancien
                </span>
              )
            )}
            <span className="flex items-center gap-1 ml-auto">
              <span className="text-slate-600 dark:text-slate-300">à :</span>
              <select
                value={teacherFor(p)}
                onChange={e => setChoice(c => ({ ...c, [p.id]: e.target.value }))}
                className="max-w-[14rem] truncate p-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-bold"
              >
                {teachers.map(t => (
                  <option key={t.uid} value={t.uid}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => assign([p])}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg"
              >
                Rattacher
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(p)}
                title="Supprimer ce plan (test ou doublon)"
                className="px-2 py-1 bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 text-red-800 dark:text-red-200 disabled:opacity-50 font-bold rounded-lg"
              >
                🗑️
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-700 dark:text-red-300 font-bold">{error}</p>}
    </div>
  );
}
