import React, { useEffect, useState } from 'react';

import { BILLING_CHANGED_EVENT } from './AiCreditsButton';
import { apiFetch } from '../services/api';
import { BillingConfig, DEFAULT_BILLING_CONFIG, packBreakdown, sanitizeBillingConfig } from '../lib/billing';
const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// Panneau administrateur « Crédits IA » : interrupteur général, tarifs, recharges et soldes des enseignants.

interface TeacherBalance {
  teacherId: string;
  name: string;
  email: string;
  credits: number | null;
  used: number;
  purchased: number;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export default function BillingAdminPanel() {
  const [cfg, setCfg] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
  const [packsText, setPacksText] = useState(DEFAULT_BILLING_CONFIG.packsEur.join(', '));
  const [teachers, setTeachers] = useState<TeacherBalance[]>([]);
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grant, setGrant] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/admin/billing');
      setCfg(data.config);
      setPacksText(data.config.packsEur.join(', '));
      setTeachers(data.teachers || []);
      setPaymentConfigured(!!data.paymentConfigured);
    } catch (e: any) {
      setMessage({ text: e.message, ok: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const draft = sanitizeBillingConfig({ ...cfg, packsEur: packsText.split(/[;,\s]+/).filter(Boolean) });

  const save = async (next: BillingConfig) => {
    setSaving(true);
    try {
      const data = await apiFetch('/api/admin/billing/config', { config: next });
      setCfg(data.config);
      setPacksText(data.config.packsEur.join(', '));
      window.dispatchEvent(new Event(BILLING_CHANGED_EVENT));
      setMessage({ text: data.config.enabled ? 'Paiement par crédits activé.' : 'Réglages enregistrés.', ok: true });
    } catch (e: any) {
      setMessage({ text: e.message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const doGrant = async (teacherId: string) => {
    const credits = parseInt(grant[teacherId] || '', 10);
    if (!credits) return;
    try {
      const data = await apiFetch('/api/admin/billing/grant', { teacherId, credits });
      setTeachers(prev => prev.map(t => t.teacherId === teacherId ? { ...t, credits: data.credits } : t));
      setGrant(prev => ({ ...prev, [teacherId]: '' }));
      window.dispatchEvent(new Event(BILLING_CHANGED_EVENT));
      setMessage({ text: `Solde mis à jour : ${data.credits} crédits.`, ok: true });
    } catch (e: any) {
      setMessage({ text: e.message, ok: false });
    }
  };

  if (loading) {
    return <div className="text-xs text-gray-400 flex items-center gap-2"><span className="animate-spin">⟳</span> Chargement…</div>;
  }

  const field = (label: string, key: keyof BillingConfig, step = '0.01', help?: string) => (
    <label className="text-xs">
      <span className="block text-gray-400 mb-1">{label}</span>
      <input type="number" step={step} value={String(cfg[key])}
        onChange={e => setCfg({ ...cfg, [key]: e.target.value as any })}
        className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-gray-100" />
      {help && <span className="block text-[10px] text-gray-400 mt-1">{help}</span>}
    </label>
  );

  return (
    <div className="space-y-6 text-gray-100">
      {message && (
        <div className={cn('rounded-xl p-3 text-sm font-bold', message.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300')}>
          {message.text}
        </div>
      )}

      <div className={cn('rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3', cfg.enabled ? 'border-emerald-600 bg-emerald-950/40' : 'border-white/10 bg-black/40')}>
        <div className="text-sm">
          <div className="font-black">{cfg.enabled ? 'Paiement par crédits : ACTIVÉ' : 'Paiement par crédits : désactivé'}</div>
          <div className="text-xs text-gray-400 mt-1">
            {cfg.enabled
              ? 'Chaque demande à l\'IA (liste d\'élèves mal présentée, trombinoscope) est décomptée du crédit de l\'enseignant. Les listes simples et le placement des élèves, faits sans IA, ne sont jamais décomptés. Les enseignants voient le bouton « Crédits IA ».'
              : 'L\'IA est gratuite et illimitée pour tous. Rien n\'est décompté.'}
          </div>
          {!paymentConfigured && (
            <div className="text-xs text-amber-300 mt-1">
              Paiement Stripe non branché (variable STRIPE_SECRET_KEY absente) : les enseignants verront leurs crédits mais ne pourront pas recharger.
            </div>
          )}
        </div>
        <button onClick={() => save({ ...draft, enabled: !cfg.enabled })} disabled={saving}
          className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 text-white', cfg.enabled ? 'bg-red-700 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-500')}>
          <span aria-hidden>⏻</span> {cfg.enabled ? 'Désactiver' : 'Activer'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {field('Prix d\'un crédit (€)', 'pricePerCorrectionEur', '0.001')}
        {field('Crédits offerts au départ', 'freeCredits', '1', 'Donnés à chaque enseignant à sa première demande à l\'IA')}
        <label className="text-xs">
          <span className="block text-gray-400 mb-1">Recharges proposées (€)</span>
          <input type="text" value={packsText} onChange={e => setPacksText(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-gray-100" />
          <span className="block text-[10px] text-gray-400 mt-1">Séparées par des virgules</span>
        </label>
        {field('Frais Stripe fixes (€)', 'stripeFixedEur')}
        {field('Frais Stripe (%)', 'stripePercent', '0.1')}
        <label className="text-xs flex items-center gap-2 mt-5">
          <input type="checkbox" checked={cfg.adminsExempt} onChange={e => setCfg({ ...cfg, adminsExempt: e.target.checked })} />
          Administrateurs et leurs classes non décomptés
        </label>
      </div>

      <div>
        <div className="text-xs font-bold mb-2">Aperçu de ce que verront les enseignants</div>
        <table className="w-full text-xs border border-white/10">
          <thead className="bg-black/40 text-gray-400">
            <tr><th className="p-2 text-left">Recharge</th><th className="p-2">Frais Stripe</th><th className="p-2">Reste</th><th className="p-2">Crédits</th></tr>
          </thead>
          <tbody>
            {draft.packsEur.map(p => {
              const b = packBreakdown(p, draft);
              return (
                <tr key={p} className="border-t border-white/10 text-center">
                  <td className="p-2 text-left">{eur(b.eur)}</td>
                  <td className="p-2">{eur(b.stripeFeeEur)} ({Math.round((b.stripeFeeEur / b.eur) * 100)} %)</td>
                  <td className="p-2">{eur(b.netEur)}</td>
                  <td className="p-2 font-bold text-amber-300">{b.corrections}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button onClick={() => save({ ...draft, enabled: cfg.enabled })} disabled={saving}
          className="mt-3 flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer">
          <span aria-hidden>💾</span> Enregistrer les réglages
        </button>
      </div>

      <div>
        <div className="text-xs font-bold mb-2">Soldes des enseignants</div>
        <table className="w-full text-xs border border-white/10">
          <thead className="bg-black/40 text-gray-400">
            <tr><th className="p-2 text-left">Professeur</th><th className="p-2">Solde</th><th className="p-2">Utilisés</th><th className="p-2">Achetés</th><th className="p-2">Ajouter / retirer</th></tr>
          </thead>
          <tbody>
            {teachers.map(t => (
              <tr key={t.teacherId} className="border-t border-white/10 text-center">
                <td className="p-2 text-left">{t.name}{t.email && t.email !== t.name ? <span className="block text-[10px] text-gray-400">{t.email}</span> : null}</td>
                <td className="p-2">{t.credits === null ? <span className="text-gray-400">{cfg.freeCredits} (pas encore utilisé)</span> : t.credits}</td>
                <td className="p-2">{t.used}</td>
                <td className="p-2">{t.purchased}</td>
                <td className="p-2">
                  <div className="flex gap-1 justify-center">
                    <input type="number" placeholder="ex. 50 ou -10" value={grant[t.teacherId] || ''}
                      onChange={e => setGrant(prev => ({ ...prev, [t.teacherId]: e.target.value }))}
                      className="w-24 bg-black/40 border border-white/10 rounded-lg px-2 py-1" />
                    <button onClick={() => doGrant(t.teacherId)} className="bg-black/40 border border-white/10 px-2 rounded-lg cursor-pointer hover:bg-white/10">OK</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
