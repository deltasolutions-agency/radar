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
