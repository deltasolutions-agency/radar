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
 * Funzione di RIFERIMENTO per qualsiasi importo da incassare.
 *
 * I prezzi inseriti (Service/SubscriptionItem.priceCents) sono NETTI (IVA
 * esclusa): il totale realmente addebitato è il LORDO ottenuto AGGIUNGENDO il
 * 22% al netto. IVA = round(netto × aliquota), lordo = netto + IVA (centesimi
 * interi, arrotondamento con Math.round).
 */
export function addVatToNet(
  netCents: number,
  vatRate: number = VAT_RATE,
): { netCents: number; vatCents: number; grossCents: number } {
  const vatCents = Math.round(netCents * vatRate);
  const grossCents = netCents + vatCents;
  return { netCents, vatCents, grossCents };
}

/**
 * @deprecated I prezzi in ingresso sono NETTI: per ottenere il totale da
 * incassare usare {@link addVatToNet}. Questa funzione SCORPORA l'IVA da un
 * importo GIÀ lordo e va usata solo dove esiste davvero un lordo come sorgente
 * di verità, non per derivare il totale dal netto.
 *
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
