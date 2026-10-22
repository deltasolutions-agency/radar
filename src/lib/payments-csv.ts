import "server-only";
import {
  paymentBreakdown,
  refundStateOf,
  REFUND_STATE_LABELS,
  needsCreditNote,
} from "@/lib/payment-ledger";
import { formatRomeDate } from "@/lib/rome-time";
import {
  paymentClientLabel,
  paymentServiceLabels,
  type PaymentListRow,
} from "@/lib/payments-list";

// Export per il commercialista: separatore ";", decimali con la virgola, BOM
// UTF-8 per l'apertura corretta in Excel.

/** Centesimi → "1234,56" (nessun separatore delle migliaia). */
export function csvAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

function csvCell(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Data salvata come giorno (mezzanotte UTC) → "gg/mm/aaaa". */
function dayLabel(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "";
}

const HEADER = [
  "Data pagamento",
  "Cliente",
  "P. IVA / Cod. fiscale",
  "Servizi",
  "Metodo",
  "Stato",
  "Imponibile",
  "IVA",
  "Commissione",
  "Totale incassato",
  "Rimborsato",
  "Netto incassato",
  "Ricevuta",
  "Fatturato",
  "N. fattura",
  "Data fattura",
  "Nota di credito",
  "N. nota di credito",
  "Data nota di credito",
];

export function paymentsToCsv(rows: PaymentListRow[]): string {
  const lines = [HEADER.join(";")];
  for (const r of rows) {
    const b = paymentBreakdown(r);
    const client = r.subscription.client;
    const creditNote = r.creditNoteIssuedAt
      ? "Emessa"
      : needsCreditNote(r)
        ? "Da emettere"
        : "";
    lines.push(
      [
        r.paidAt ? formatRomeDate(r.paidAt) : "",
        paymentClientLabel(r),
        client.partitaIva ?? client.codiceFiscale ?? "",
        paymentServiceLabels(r).join(" | "),
        r.method === "STRIPE" ? "Carta" : "Manuale",
        REFUND_STATE_LABELS[refundStateOf(r)],
        csvAmount(b.taxableCents),
        csvAmount(b.vatCents),
        csvAmount(b.serviceFeeCents),
        csvAmount(b.collectedCents),
        csvAmount(b.refundedCents),
        csvAmount(b.netCents),
        r.receipt?.number ?? "",
        r.invoicedAt ? "Sì" : "No",
        r.invoiceNumber ?? "",
        dayLabel(r.invoiceDate),
        creditNote,
        r.creditNoteNumber ?? "",
        dayLabel(r.creditNoteDate),
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
