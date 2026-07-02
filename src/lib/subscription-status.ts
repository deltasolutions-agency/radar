import { SubscriptionStatus, BillingPeriod } from "@prisma/client";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Soglia (in giorni) entro cui un abbonamento è considerato IN_SCADENZA.
 * Dipende dalla durata del periodo:
 *  - periodi lunghi (ANNUALE, o PERSONALIZZATA ≥ 60gg) → 30 giorni
 *  - periodi brevi (MENSILE, o PERSONALIZZATA < 60gg / null) → 10 giorni
 */
function expiryThresholdDays(
  billingPeriod: BillingPeriod,
  customPeriodDays: number | null,
): number {
  if (billingPeriod === "ANNUALE") return 30;
  if (billingPeriod === "PERSONALIZZATA") {
    return customPeriodDays != null && customPeriodDays >= 60 ? 30 : 10;
  }
  // MENSILE (e qualsiasi altro caso breve).
  return 10;
}

/**
 * Calcola lo stato *atteso* dell'abbonamento in base a date e periodicità.
 * Usato dal cron (allineamento periodico) e alla creazione.
 *
 * Priorità:
 *  1. CESSATO / SOSPESO → stati manuali bloccanti, restituiti invariati.
 *  2. Scaduto (diffDays < 0) → SCADUTO.
 *  3. Entro la soglia dinamica → IN_SCADENZA (ha priorità su RINNOVATO).
 *  4. Rinnovato di recente (entro la soglia da lastRenewalAt) → RINNOVATO.
 *  5. Altrimenti → ATTIVO.
 *
 * Nota: RINNOVATO NON è più bloccante — viene ricalcolato dinamicamente.
 */
export function computeSubscriptionStatus(sub: {
  status: SubscriptionStatus;
  endDate: Date;
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
  lastRenewalAt: Date | null;
}): SubscriptionStatus {
  // 1. Stati manuali bloccanti.
  if (sub.status === "CESSATO" || sub.status === "SOSPESO") {
    return sub.status;
  }

  const now = new Date();
  const threshold = expiryThresholdDays(sub.billingPeriod, sub.customPeriodDays);

  // 3. Giorni alla scadenza.
  const diffDays = Math.ceil((sub.endDate.getTime() - now.getTime()) / MS_PER_DAY);

  // 2. Scaduto.
  if (diffDays < 0) return "SCADUTO";

  // 3. In scadenza (priorità su RINNOVATO).
  if (diffDays <= threshold) return "IN_SCADENZA";

  // 4. Rinnovato di recente.
  if (sub.lastRenewalAt) {
    const daysSinceRenewal = Math.ceil(
      (now.getTime() - sub.lastRenewalAt.getTime()) / MS_PER_DAY,
    );
    if (daysSinceRenewal <= threshold) return "RINNOVATO";
  }

  // 5. Attivo.
  return "ATTIVO";
}
