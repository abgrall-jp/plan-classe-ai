import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { apiFetch } from '../services/api';
import type { PackBreakdown } from '../lib/billing';
const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Paiement en attente de vérification : gardé jusqu'à ce que le serveur l'ait confirmé. */
const PENDING_KEY = 'pending_credits_session';
/** Émis par le panneau administrateur quand les réglages changent, pour rafraîchir le bouton. */
export const BILLING_CHANGED_EVENT = 'billing-config-changed';

// Bouton « Crédits IA » de l'Espace Enseignant : solde, explication des frais et recharge.
// N'apparaît que lorsque l'administrateur a activé le paiement par crédits.

interface BillingMe {
  enabled: boolean;
  exempt: boolean;
  credits: number;
  used: number;
  pricePerCorrectionEur: number;
  stripeFixedEur: number;
  stripePercent: number;
  packs: PackBreakdown[];
  paymentConfigured: boolean;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export default function AiCreditsButton() {
  const [me, setMe] = useState<BillingMe | null>(null);
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = async () => {
    try { setMe(await apiFetch<BillingMe>('/api/billing/me')); } catch { /* hors ligne : le bouton reste masqué */ }
  };

  const confirmPending = async () => {
    let sessionId: string | null = null;
    try { sessionId = sessionStorage.getItem(PENDING_KEY); } catch { /* stockage indisponible */ }
    if (!sessionId) return;
    try {
      const d = await apiFetch('/api/billing/confirm', { sessionId });
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      setMessage(d.paid
        ? { text: `Recharge reçue : ${d.credits} crédits ajoutés.`, ok: true }
        : { text: 'Paiement en attente de validation par la banque.', ok: true });
      setOpen(true);
    } catch (e: any) {
      if (e?.status === 401) return; // connexion pas encore prête : on réessaiera
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      setMessage({ text: e?.message || "Le paiement n'a pas pu être vérifié.", ok: false });
      setOpen(true);
    }
  };

  useEffect(() => {
    // Retour de la page de paiement : le numéro de paiement est mis de côté, puis vérifié auprès de Stripe
    // par le serveur dès que la connexion de l'enseignant est prête.
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('credits_session');
    const cancelled = params.get('credits_cancelled');
    if (sessionId || cancelled) {
      params.delete('credits_session');
      params.delete('credits_cancelled');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash);
    }
    if (cancelled) {
      setMessage({ text: "Recharge annulée : aucun montant n'a été prélevé.", ok: true });
      setOpen(true);
    }
    if (sessionId) {
      try { sessionStorage.setItem(PENDING_KEY, sessionId); } catch { /* ignore */ }
    }

    const refresh = () => { if (auth.currentUser) confirmPending().finally(load); };
    const unsubscribe = onIdTokenChanged(auth, user => { if (user) refresh(); else setMe(null); });
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(BILLING_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener(BILLING_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  if (!me || !me.enabled) return null;

  const buy = async (amount: number) => {
    setBuying(amount);
    try {
      const data = await apiFetch('/api/billing/checkout', { eur: amount });
      if (!data.url) throw new Error('Paiement indisponible.');
      window.location.href = data.url;
    } catch (e: any) {
      setMessage({ text: e?.message || 'Paiement indisponible.', ok: false });
      setBuying(null);
    }
  };

  const low = !me.exempt && me.credits < 5;

  return (
    <>
      <button
        onClick={() => { setOpen(true); load(); }}
        className={cn(
          'flex items-center gap-2 text-white px-3.5 py-1.5 rounded-xl font-bold text-xs transition border cursor-pointer',
          low ? 'bg-red-950/80 border-red-500/50 hover:bg-red-900/80' : 'bg-amber-950/80 border-amber-600/40 hover:bg-amber-900/80'
        )}
        title="Crédits IA"
      >
        <span aria-hidden>🪙</span>
        <span>
          {me.exempt ? 'Crédits IA : non décomptés (admin)' : `Crédits IA : ${me.credits}${low ? ', pensez à recharger' : ''}`}
        </span>
      </button>

      {/* Rendue dans <body> : l'en-tête floutée qui contient le bouton couperait la fenêtre. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-[#141414] border border-white/10 rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 text-gray-100 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <h2 className="text-lg font-black flex items-center gap-2"><span aria-hidden>🪙</span> Crédits IA</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white cursor-pointer"><span aria-label="Fermer">✕</span></button>
            </div>

            {message && (
              <div className={cn('rounded-xl p-3 text-sm font-bold', message.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300')}>
                {message.text}
              </div>
            )}

            <div className="bg-black/40 rounded-xl p-3 text-sm">
              {me.exempt ? (
                <p>Compte administrateur : vos demandes à l'IA ne sont pas décomptées. Cette fenêtre vous montre ce que voient les enseignants.</p>
              ) : (
                <p>Il vous reste <strong className="text-amber-300">{me.credits} crédits</strong>. {me.used} ont déjà été utilisés.</p>
              )}
            </div>

            <div className="text-xs text-gray-400 space-y-1.5 leading-relaxed">
              <p><strong className="text-gray-100">Comment ça marche :</strong> 1 crédit = 1 demande à l'IA : lecture d'une liste d'élèves mal présentée
                ou d'un trombinoscope (PDF ou image). Une liste simple, un élève par ligne, est lue sans IA et ne coûte rien, comme le placement des élèves. Une demande qui échoue est remboursée.</p>
              <p><strong className="text-gray-100">Le prix :</strong> un crédit est facturé {eur(me.pricePerCorrectionEur)}.
                À chaque recharge, la banque en ligne (Stripe) prélève {eur(me.stripeFixedEur)} + {me.stripePercent.toLocaleString('fr-FR')} % du montant.
                Ces frais sont déduits avant le calcul : plus la recharge est grande, plus ils pèsent peu.</p>
            </div>

            <table className="w-full text-xs border border-white/10">
              <thead className="bg-black/40 text-gray-400">
                <tr>
                  <th className="p-2 text-left">Recharge</th>
                  <th className="p-2">Frais Stripe</th>
                  <th className="p-2">Crédits obtenus</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {me.packs.map(p => (
                  <tr key={p.eur} className="border-t border-white/10 text-center">
                    <td className="p-2 text-left font-bold">{eur(p.eur)}</td>
                    <td className="p-2 text-gray-400">{eur(p.stripeFeeEur)} ({Math.round((p.stripeFeeEur / p.eur) * 100)} %)</td>
                    <td className="p-2 text-amber-300 font-bold">{p.corrections}</td>
                    <td className="p-2">
                      <button
                        onClick={() => buy(p.eur)}
                        disabled={!me.paymentConfigured || buying !== null || p.corrections === 0}
                        className="flex items-center gap-1 mx-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-2 py-1 rounded-lg cursor-pointer"
                      >
                        💳 {buying === p.eur ? '…' : 'Payer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!me.paymentConfigured && (
              <p className="text-xs text-gray-400">Le paiement en ligne n'est pas encore branché. Contactez l'administrateur pour obtenir des crédits.</p>
            )}
            <p className="text-[11px] text-gray-400">Paiement par carte sur la page sécurisée de Stripe. Les crédits n'expirent pas.</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
