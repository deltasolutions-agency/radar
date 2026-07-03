import { SubscriptionStatus, BillingPeriod } from "@prisma/client";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Soglia (in giorni) entro cui una riga di servizio è considerata IN_SCADENZA.
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
 * Campi minimi di un SubscriptionItem necessari al calcolo dello stato.
 * (In Fase 8 lo stato/scadenza vivono sulla singola riga, non sull'abbonamento.)
 */
export type ItemStatusInput = {
  status: SubscriptionStatus;
  endDate: Date;
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
  lastRenewalAt: Date | null;
};

/**
 * Calcola lo stato *atteso* di una riga di servizio (SubscriptionItem) in base a
 * date e periodicità. Usato dal cron (allineamento periodico) e alla creazione.
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
export function computeItemStatus(item: ItemStatusInput): SubscriptionStatus {
  // 1. Stati manuali bloccanti.
  if (item.status === "CESSATO" || item.status === "SOSPESO") {
    return item.status;
  }

  const now = new Date();
  const threshold = expiryThresholdDays(
    item.billingPeriod,
    item.customPeriodDays,
  );

  // 3. Giorni alla scadenza.
  const diffDays = Math.ceil(
    (item.endDate.getTime() - now.getTime()) / MS_PER_DAY,
  );

  // 2. Scaduto.
  if (diffDays < 0) return "SCADUTO";

  // 3. In scadenza (priorità su RINNOVATO).
  if (diffDays <= threshold) return "IN_SCADENZA";

  // 4. Rinnovato di recente.
  if (item.lastRenewalAt) {
    const daysSinceRenewal = Math.ceil(
      (now.getTime() - item.lastRenewalAt.getTime()) / MS_PER_DAY,
    );
    if (daysSinceRenewal <= threshold) return "RINNOVATO";
  }

  // 5. Attivo.
  return "ATTIVO";
}

/**
 * @deprecated Alias storico di {@link computeItemStatus}. In Fase 8 lo stato è
 * per-riga: preferire `computeItemStatus`. Mantenuto finché i chiamanti non
 * saranno aggiornati (Step successivi).
 */
export const computeSubscriptionStatus = computeItemStatus;
