import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import type { TeacherAccount } from '../services/teacherAuthService';

interface OrphanPlan { id: string; teacherName?: string; className?: string; period?: string; updatedAt?: string }

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
export default function OrphanPlansPanel({ teachers, currentUid, onAssigned }: {
  teachers: TeacherAccount[];
  currentUid: string;
  onAssigned?: () => void;
}) {
  const [plans, setPlans] = useState<OrphanPlan[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => apiFetch<{ plans: OrphanPlan[] }>('/api/admin/orphan-plans')
    .then(r => setPlans(r.plans || []))
    .catch(e => setError(e.message));

  useEffect(() => { load(); }, []);

  if (!plans || plans.length === 0) return error ? <p className="text-xs text-red-600">{error}</p> : null;

  const teacherFor = (p: OrphanPlan) => choice[p.id] || guessTeacher(p, teachers, currentUid);

  const assign = async (list: OrphanPlan[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const p of list) await apiFetch('/api/admin/assign-plan', { planId: p.id, teacherId: teacherFor(p) });
      await load();
      onAssigned?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
      <ul className="space-y-2">
        {plans.map(p => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800">
            <span className="font-bold text-slate-900 dark:text-white min-w-0">
              Classe {p.className || '?'} · {p.period || 'sans période'}
            </span>
            <span className="text-slate-500 dark:text-slate-400">écrit « {p.teacherName || 'sans nom'} »</span>
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
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-700 dark:text-red-300 font-bold">{error}</p>}
    </div>
  );
}
