import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { refundStateOf } from "@/lib/payment-ledger";
import { romeYmd } from "@/lib/rome-time";

type Params = { params: { id: string } };

const bodySchema = z.object({
  // invoice = fattura emessa; creditNote = nota di credito emessa.
  target: z.enum(["invoice", "creditNote"]),
  issued: z.boolean(),
  number: z.string().trim().max(60).optional().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida")
    .optional()
    .nullable(),
});

/** Data (solo giorno) salvata a mezzanotte UTC, come le date delle righe. */
const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type InvoicingFields = {
  invoicedAt: Date | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  creditNoteIssuedAt: Date | null;
  creditNoteNumber: string | null;
  creditNoteDate: Date | null;
};

// PATCH /api/payments/[id]/invoicing — solo admin.
// Segna/toglie "fatturato" (con numero e data fattura facoltativi) oppure "nota
// di credito emessa" (solo su pagamenti fatturati e stornati). Ogni cambio
// scrive un AdminActionLog con i valori prima/dopo.
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = bodySchema.parse(await req.json());

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        invoicedAt: true,
        invoiceNumber: true,
        invoiceDate: true,
        creditNoteIssuedAt: true,
        creditNoteNumber: true,
        creditNoteDate: true,
        items: { select: { status: true } },
      },
    });
    if (!payment) return error("Pagamento non trovato", 404);
    if (payment.status !== "CONFERMATO" && payment.status !== "RIMBORSATO") {
      return error("Si fatturano solo pagamenti incassati", 400);
    }

    const number = data.number?.trim() || null;
    const date = dayDate(data.date ?? romeYmd(new Date()));
    let update: {
      invoicedAt?: Date | null;
      invoiceNumber?: string | null;
      invoiceDate?: Date | null;
      creditNoteIssuedAt?: Date | null;
      creditNoteNumber?: string | null;
      creditNoteDate?: Date | null;
    };
    let action: string;

    if (data.target === "invoice") {
      if (data.issued) {
        update = { invoicedAt: payment.invoicedAt ?? new Date(), invoiceNumber: number, invoiceDate: date };
        action = "PAYMENT_INVOICE_SET";
      } else {
        if (payment.creditNoteIssuedAt) {
          return error("Prima togli la nota di credito emessa", 409);
        }
        update = { invoicedAt: null, invoiceNumber: null, invoiceDate: null };
        action = "PAYMENT_INVOICE_UNSET";
      }
    } else if (data.issued) {
      if (!payment.invoicedAt) {
        return error("La nota di credito si emette solo su pagamenti fatturati", 400);
      }
      if (refundStateOf(payment) === "PAGATO") {
        return error("Il pagamento non è stato stornato", 400);
      }
      update = {
        creditNoteIssuedAt: payment.creditNoteIssuedAt ?? new Date(),
        creditNoteNumber: number,
        creditNoteDate: date,
      };
      action = "PAYMENT_CREDIT_NOTE_SET";
    } else {
      update = { creditNoteIssuedAt: null, creditNoteNumber: null, creditNoteDate: null };
      action = "PAYMENT_CREDIT_NOTE_UNSET";
    }

    const snapshot = (p: InvoicingFields) => ({
      invoicedAt: iso(p.invoicedAt),
      invoiceNumber: p.invoiceNumber,
      invoiceDate: iso(p.invoiceDate),
      creditNoteIssuedAt: iso(p.creditNoteIssuedAt),
      creditNoteNumber: p.creditNoteNumber,
      creditNoteDate: iso(p.creditNoteDate),
    });

    const [updated] = await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: update }),
      prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action,
          entityType: "Payment",
          entityId: payment.id,
          details: { before: snapshot(payment), after: { ...snapshot(payment), ...isoAll(update) } },
        },
      }),
    ]);

    return json({ payment: snapshot(updated) });
  });
}

/** Valori dell'update serializzati come nello snapshot. */
function isoAll(u: Record<string, Date | string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(u).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : (v ?? null)]),
  );
}
