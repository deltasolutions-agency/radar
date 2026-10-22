import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { romeDayStart, romeNextDayStart } from "@/lib/rome-time";
import { invoiceDueBefore } from "@/lib/payment-ledger";

// Filtri della sezione Pagamenti, condivisi da pagina ed export CSV.

export const PAYMENT_STATE_FILTERS = {
  pagato: "Pagato",
  stornato: "Stornato",
  parziale: "Stornato parz.",
} as const;
export type PaymentStateFilter = keyof typeof PAYMENT_STATE_FILTERS;

export const INVOICED_FILTERS = {
  si: "Fatturato",
  no: "Non fatturato",
  "da-fatturare": "Da fatturare (> 10 gg)",
  "nota-credito": "Nota di credito da emettere",
} as const;
export type InvoicedFilter = keyof typeof INVOICED_FILTERS;

export type PaymentFilters = {
  from?: string; // YYYY-MM-DD (Europe/Rome)
  to?: string;
  clientId?: string;
  method?: PaymentMethod;
  state?: PaymentStateFilter;
  invoiced?: InvoicedFilter;
  q?: string;
  page: number;
};

export function parsePaymentFilters(sp: Record<string, string | undefined>): PaymentFilters {
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  return {
    from: date(sp.from),
    to: date(sp.to),
    clientId: sp.clientId?.trim() || undefined,
    method: pick(sp.method, ["STRIPE", "MANUALE"] as const),
    state: pick(sp.state, Object.keys(PAYMENT_STATE_FILTERS) as PaymentStateFilter[]),
    invoiced: pick(sp.invoiced, Object.keys(INVOICED_FILTERS) as InvoicedFilter[]),
    q: sp.q?.trim() || undefined,
    page: Math.max(1, parseInt(sp.page ?? "1", 10) || 1),
  };
}

const SOME_ITEM_REFUNDED: Prisma.PaymentWhereInput = {
  items: { some: { status: "RIMBORSATO" } },
};

/**
 * Where Prisma: TUTTI i pagamenti incassati (confermati o stornati, carta e
 * manuali). Lo storno totale porta il Payment a RIMBORSATO; quello parziale
 * lascia CONFERMATO con almeno una riga RIMBORSATO.
 */
export function buildPaymentWhere(f: PaymentFilters, now: Date): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [{ status: { in: ["CONFERMATO", "RIMBORSATO"] } }];

  if (f.from || f.to) {
    and.push({
      paidAt: {
        ...(f.from ? { gte: romeDayStart(f.from) } : {}),
        ...(f.to ? { lt: romeNextDayStart(f.to) } : {}),
      },
    });
  }
  if (f.clientId) and.push({ subscription: { clientId: f.clientId } });
  if (f.method) and.push({ method: f.method });

  if (f.state === "stornato") and.push({ status: "RIMBORSATO" });
  if (f.state === "parziale") and.push({ status: "CONFERMATO" }, SOME_ITEM_REFUNDED);
  if (f.state === "pagato") {
    and.push({ status: "CONFERMATO", items: { none: { status: "RIMBORSATO" } } });
  }

  if (f.invoiced === "si") and.push({ invoicedAt: { not: null } });
  if (f.invoiced === "no") and.push({ invoicedAt: null });
  if (f.invoiced === "da-fatturare") {
    and.push({ invoicedAt: null, status: "CONFERMATO", paidAt: { lt: invoiceDueBefore(now) } });
  }
  if (f.invoiced === "nota-credito") {
    and.push({
      invoicedAt: { not: null },
      creditNoteIssuedAt: null,
      OR: [{ status: "RIMBORSATO" }, SOME_ITEM_REFUNDED],
    });
  }

  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { subscription: { client: { name: contains } } },
        { subscription: { client: { ragioneSociale: contains } } },
        { items: { some: { subscriptionItem: { endClientName: contains } } } },
        { invoiceNumber: contains },
        { creditNoteNumber: contains },
        { receipt: { number: contains } },
      ],
    });
  }
  return { AND: and };
}

/** Campi letti da pagina ed export (una query, nessun N+1). */
export const PAYMENT_LIST_SELECT = {
  id: true,
  status: true,
  method: true,
  paidAt: true,
  amountCents: true,
  serviceFeeCents: true,
  refundedServiceFeeCents: true,
  currency: true,
  invoicedAt: true,
  invoiceNumber: true,
  invoiceDate: true,
  creditNoteIssuedAt: true,
  creditNoteNumber: true,
  creditNoteDate: true,
  subscriptionId: true,
  subscription: {
    select: {
      client: {
        select: {
          id: true,
          name: true,
          ragioneSociale: true,
          partitaIva: true,
          codiceFiscale: true,
        },
      },
    },
  },
  receipt: {
    select: { number: true, token: true, taxableAmountCents: true, vatAmountCents: true },
  },
  items: {
    select: {
      status: true,
      amountCents: true,
      subscriptionItem: {
        select: { quantity: true, endClientName: true, service: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.PaymentSelect;

export type PaymentListRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_LIST_SELECT }>;

export const PAYMENT_LIST_ORDER: Prisma.PaymentOrderByWithRelationInput[] = [
  { paidAt: "desc" },
  { createdAt: "desc" },
];

/** Tutti i pagamenti filtrati (export e riga totali). */
export function findAllPayments(where: Prisma.PaymentWhereInput) {
  return prisma.payment.findMany({ where, orderBy: PAYMENT_LIST_ORDER, select: PAYMENT_LIST_SELECT });
}

/** Cliente come in tutta la dashboard: ragione sociale, altrimenti referente. */
export function paymentClientLabel(row: PaymentListRow): string {
  const c = row.subscription.client;
  return c.ragioneSociale?.trim() ? c.ragioneSociale : c.name;
}

/** Servizi del pagamento con quantità e cliente finale (es. "Hosting ×2 – Bar Sport"). */
export function paymentServiceLabels(row: PaymentListRow): string[] {
  return row.items.map((pi) => {
    const it = pi.subscriptionItem;
    const name = it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name;
    return it.endClientName ? `${name} – ${it.endClientName}` : name;
  });
}
