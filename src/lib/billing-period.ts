import type { BillingPeriod } from "@prisma/client";

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Durata del periodo in giorni dal billingPeriod (snapshot subscription):
 * MENSILE → 30, ANNUALE → 365, PERSONALIZZATA → customPeriodDays (null se assente).
 * Condiviso da confirm-payment (rinnovo) e payment-checkout (periodo coperto).
 */
export function periodDurationDays(sub: {
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
}): number | null {
  switch (sub.billingPeriod) {
    case "MENSILE":
      return 30;
    case "ANNUALE":
      return 365;
    case "PERSONALIZZATA":
      return sub.customPeriodDays ?? null;
    default:
      return null;
  }
}

/**
 * Data di fine del PRIMO periodo con la convenzione del rinnovo: inizio +
 * durata − 1 giorno (es. ANNUALE 2026-10-22 → 2027-10-21). Date YYYY-MM-DD.
 * null per PERSONALIZZATA (nessuna precompilazione) o data non valida.
 */
export function conventionalEndDate(
  startYmd: string,
  billingPeriod: string,
): string | null {
  if (billingPeriod !== "MENSILE" && billingPeriod !== "ANNUALE") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return null;
  const start = new Date(`${startYmd}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const days = periodDurationDays({ billingPeriod, customPeriodDays: null })!;
  return new Date(start.getTime() + (days - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}
