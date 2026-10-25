/**
 * Paiement des corrections IA par crédits : règles partagées par le navigateur et le serveur.
 * Un crédit = un appel à l'IA (une correction d'élève, une génération ou une analyse du professeur).
 */

export interface BillingConfig {
  /** Interrupteur général : tant qu'il est coupé, rien n'est décompté. */
  enabled: boolean;
  /** Prix facturé d'une correction, en euros. */
  pricePerCorrectionEur: number;
  /** Crédits offerts à un enseignant lors de sa première utilisation. */
  freeCredits: number;
  /** Montants de recharge proposés, en euros. */
  packsEur: number[];
  /** Frais Stripe : partie fixe (€) et pourcentage, par paiement. */
  stripeFixedEur: number;
  stripePercent: number;
  /** Les administrateurs (et les élèves de leurs classes) ne sont pas décomptés. */
  adminsExempt: boolean;
}

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  enabled: false,
  pricePerCorrectionEur: 0.01,
  freeCredits: 100,
  packsEur: [1, 2, 5, 10, 20],
  stripeFixedEur: 0.25,
  stripePercent: 1.5,
  adminsExempt: true,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PackBreakdown {
  eur: number;
  stripeFeeEur: number;
  netEur: number;
  corrections: number;
}

/** Ce que le professeur obtient pour une recharge : les frais Stripe sont déduits avant le calcul des corrections. */
export function packBreakdown(eur: number, cfg: BillingConfig): PackBreakdown {
  const stripeFeeEur = round2(cfg.stripeFixedEur + (eur * cfg.stripePercent) / 100);
  const netEur = round2(Math.max(0, eur - stripeFeeEur));
  const corrections = cfg.pricePerCorrectionEur > 0 ? Math.floor(netEur / cfg.pricePerCorrectionEur + 1e-9) : 0;
  return { eur, stripeFeeEur, netEur, corrections };
}

/** Garde une configuration reçue (base ou formulaire) dans des bornes raisonnables. */
export function sanitizeBillingConfig(raw: any): BillingConfig {
  const d = DEFAULT_BILLING_CONFIG;
  const num = (v: any, def: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return isNaN(n) ? def : Math.min(max, Math.max(min, n));
  };
  const packs = Array.isArray(raw?.packsEur)
    ? Array.from(new Set(raw.packsEur.map((p: any) => num(p, 0, 0, 500)).filter((p: number) => p >= 1))).sort((a: any, b: any) => a - b).slice(0, 8) as number[]
    : d.packsEur;
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : d.enabled,
    pricePerCorrectionEur: num(raw?.pricePerCorrectionEur, d.pricePerCorrectionEur, 0.001, 1),
    freeCredits: Math.round(num(raw?.freeCredits, d.freeCredits, 0, 100000)),
    packsEur: packs.length > 0 ? packs : d.packsEur,
    stripeFixedEur: num(raw?.stripeFixedEur, d.stripeFixedEur, 0, 5),
    stripePercent: num(raw?.stripePercent, d.stripePercent, 0, 20),
    adminsExempt: typeof raw?.adminsExempt === "boolean" ? raw.adminsExempt : d.adminsExempt,
  };
}
