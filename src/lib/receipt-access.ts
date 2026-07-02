/**
 * Accesso pubblico alla ricevuta: la finestra dura 10 giorni dalla data di
 * emissione (issuedAt), oppure dalla data di riattivazione manuale
 * (publicAccessResetAt) se presente. Il dato non viene mai cancellato: scade
 * solo l'accesso pubblico (privacy per oscuramento, non per cancellazione).
 */

const ACCESS_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

type ReceiptAccessFields = {
  issuedAt: Date;
  publicAccessResetAt: Date | null;
};

/** Data/ora di scadenza dell'accesso pubblico. */
export function getReceiptExpiryDate(receipt: ReceiptAccessFields): Date {
  const referenceDate = receipt.publicAccessResetAt ?? receipt.issuedAt;
  return new Date(referenceDate.getTime() + ACCESS_WINDOW_MS);
}

/** true se la ricevuta è ancora accessibile pubblicamente. */
export function isReceiptPubliclyAccessible(
  receipt: ReceiptAccessFields,
): boolean {
  return new Date() < getReceiptExpiryDate(receipt);
}
