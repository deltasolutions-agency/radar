import type { BillingPeriod } from "@prisma/client";

/**
 * Un periodo è "corto" (MENSILE, o PERSONALIZZATA < 60gg / null) oppure "lungo"
 * (ANNUALE, o PERSONALIZZATA >= 60gg). Determina la scala delle soglie di
 * pre-scadenza — coerente con la soglia dinamica di computeSubscriptionStatus.
 */
export function isShortPeriod(
  billingPeriod: BillingPeriod,
  customPeriodDays: number | null,
): boolean {
  if (billingPeriod === "ANNUALE") return false;
  if (billingPeriod === "PERSONALIZZATA") {
    return !(customPeriodDays != null && customPeriodDays >= 60);
  }
  // MENSILE (e ogni altro caso) → corto.
  return true;
}
