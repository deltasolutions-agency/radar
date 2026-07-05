/** Aliquota IVA standard applicata (22%). */
export const VAT_RATE = 0.22;

export type VatBreakdown = {
  /** Totale lordo pagato (imponibile + IVA), in centesimi. */
  totalCents: number;
  /** Imponibile in centesimi. */
  taxableCents: number;
  /** IVA in centesimi. */
  vatCents: number;
};

/**
 * Scorpora l'IVA da un totale LORDO (IVA inclusa). Il totale è la fonte di
 * verità: imponibile = round(totale / 1.22), IVA = totale − imponibile. Così
 * imponibile + IVA === totale ESATTAMENTE, senza residui di arrotondamento
 * (tutto in centesimi interi).
 */
export function splitVatFromGross(totalCents: number): VatBreakdown {
  const taxableCents = Math.round(totalCents / (1 + VAT_RATE));
  const vatCents = totalCents - taxableCents;
  return { totalCents, taxableCents, vatCents };
}
