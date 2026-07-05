import { formatDate, formatEur } from "@/lib/format";

/**
 * Stringa di conferma univoca attesa per l'eliminazione del log di un pagamento:
 * numero della ricevuta se presente, altrimenti "{data} - {importo}".
 * Usata SIA dall'endpoint (validazione) SIA dalla UI (testo da digitare): deve
 * essere calcolata sugli stessi dati lato server per garantire la coincidenza.
 */
export function paymentDeleteConfirmText(p: {
  paidAt: Date | null;
  createdAt: Date;
  amountCents: number;
  currency: string;
  receipt: { number: string } | null;
}): string {
  if (p.receipt) return p.receipt.number;
  const date = p.paidAt ?? p.createdAt;
  return `${formatDate(date)} - ${formatEur(p.amountCents, p.currency)}`;
}
