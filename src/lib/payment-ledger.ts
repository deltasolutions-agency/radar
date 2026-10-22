// Conti di un pagamento confermato: stato di storno, rimborsato e netto
// incassato. UNICO calcolo usato da sezione Pagamenti, CSV, dashboard e
// ricevuta: nessuna logica di IVA, commissione o storno viene ricalcolata qui,
// si leggono solo gli importi salvati.
import type { PaymentStatus } from "@prisma/client";
import { splitVatFromGross } from "@/lib/vat";

/** Giorni dopo il pagamento oltre i quali un incasso non fatturato è "Da fatturare". */
export const INVOICE_DUE_AFTER_DAYS = 10;

export type RefundState = "PAGATO" | "STORNATO" | "STORNATO_PARZIALE";

export const REFUND_STATE_LABELS: Record<RefundState, string> = {
  PAGATO: "Pagato",
  STORNATO: "Stornato",
  STORNATO_PARZIALE: "Stornato parz.",
};

type ItemAmounts = { status: PaymentStatus; amountCents: number };

export type LedgerPayment = {
  status: PaymentStatus;
  amountCents: number;
  serviceFeeCents: number;
  refundedServiceFeeCents: number;
  items: ItemAmounts[];
};

/** Storno totale (pagamento o tutte le righe), parziale o nessuno. */
export function refundStateOf(p: {
  status: PaymentStatus;
  items: { status: PaymentStatus }[];
}): RefundState {
  const refundedItems = p.items.filter((i) => i.status === "RIMBORSATO").length;
  if (p.status === "RIMBORSATO" || (p.items.length > 0 && refundedItems === p.items.length)) {
    return "STORNATO";
  }
  return refundedItems > 0 ? "STORNATO_PARZIALE" : "PAGATO";
}

/** Rimborsato (lordo): righe stornate + quota di commissione resa. */
export function refundedCents(p: LedgerPayment): number {
  const items = p.items
    .filter((i) => i.status === "RIMBORSATO")
    .reduce((s, i) => s + i.amountCents, 0);
  return items + p.refundedServiceFeeCents;
}

/** Netto incassato: totale incassato meno rimborsato. */
export function netCollectedCents(p: LedgerPayment): number {
  return p.amountCents - refundedCents(p);
}

export type PaymentBreakdown = {
  taxableCents: number;
  vatCents: number;
  serviceFeeCents: number;
  collectedCents: number;
  refundedCents: number;
  netCents: number;
};

/**
 * Importi di un pagamento: imponibile e IVA dalla ricevuta (snapshot emesso
 * alla conferma); senza ricevuta, scorporo per riga come in create-receipt.
 */
export function paymentBreakdown(
  p: LedgerPayment & {
    receipt: { taxableAmountCents: number; vatAmountCents: number } | null;
  },
): PaymentBreakdown {
  let taxableCents = p.receipt?.taxableAmountCents ?? 0;
  let vatCents = p.receipt?.vatAmountCents ?? 0;
  if (!p.receipt) {
    for (const it of p.items) {
      const split = splitVatFromGross(it.amountCents);
      taxableCents += split.taxableCents;
      vatCents += split.vatCents;
    }
  }
  const refunded = refundedCents(p);
  return {
    taxableCents,
    vatCents,
    serviceFeeCents: p.serviceFeeCents,
    collectedCents: p.amountCents,
    refundedCents: refunded,
    netCents: p.amountCents - refunded,
  };
}

/** Somma di più scomposizioni (riga totali). */
export function sumBreakdowns(list: PaymentBreakdown[]): PaymentBreakdown {
  const out: PaymentBreakdown = {
    taxableCents: 0,
    vatCents: 0,
    serviceFeeCents: 0,
    collectedCents: 0,
    refundedCents: 0,
    netCents: 0,
  };
  for (const b of list) {
    for (const k of Object.keys(out) as (keyof PaymentBreakdown)[]) out[k] += b[k];
  }
  return out;
}

/** Pagamento fatturato e poi stornato (in tutto o in parte) senza nota di credito. */
export function needsCreditNote(p: {
  status: PaymentStatus;
  items: { status: PaymentStatus }[];
  invoicedAt: Date | null;
  creditNoteIssuedAt: Date | null;
}): boolean {
  return !!p.invoicedAt && !p.creditNoteIssuedAt && refundStateOf(p) !== "PAGATO";
}

/** Incasso non fatturato da più di INVOICE_DUE_AFTER_DAYS giorni (e non stornato del tutto). */
export function isInvoiceOverdue(
  p: {
    status: PaymentStatus;
    items: { status: PaymentStatus }[];
    invoicedAt: Date | null;
    paidAt: Date | null;
  },
  now: Date,
): boolean {
  if (p.invoicedAt || !p.paidAt || refundStateOf(p) === "STORNATO") return false;
  return p.paidAt.getTime() < invoiceDueBefore(now).getTime();
}

/** Pagati prima di questo istante e non fatturati → "Da fatturare". */
export function invoiceDueBefore(now: Date): Date {
  return new Date(now.getTime() - INVOICE_DUE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}
