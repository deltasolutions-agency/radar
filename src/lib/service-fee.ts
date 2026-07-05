/** Aliquota del costo di servizio Radar applicato ai pagamenti Stripe (1,5%). */
export const SERVICE_FEE_RATE = 0.015;

/**
 * Costo di servizio (1,5%) sul totale dei servizi, in centesimi interi.
 * Arrotondato al centesimo con Math.round (nessun residuo di float).
 * Applicabile SOLO ai pagamenti Stripe e SOLO se il contenitore ha
 * Subscription.serviceFeeEnabled = true.
 */
export function computeServiceFeeCents(
  servicesTotalCents: number,
  enabled: boolean,
): number {
  if (!enabled || servicesTotalCents <= 0) return 0;
  return Math.round(servicesTotalCents * SERVICE_FEE_RATE);
}
