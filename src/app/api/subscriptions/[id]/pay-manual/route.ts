import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { manualPaymentSchema } from "@/lib/validations";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/pay-manual
// Body: manualPaymentSchema + { subscriptionItemIds: string[] }.
// Registra un pagamento manuale (già incassato) che copre le righe indicate e
// le rinnova. L'importo totale è derivato dai prezzi correnti delle righe (una
// PaymentItem per riga), così ricevuta e snapshot restano coerenti.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    // recordedById proviene SEMPRE dalla sessione, mai dal body.
    const session = await requireSession();

    const body = await req.json();
    const data = manualPaymentSchema.parse(body);
    const itemIds: string[] = Array.isArray(body?.subscriptionItemIds)
      ? body.subscriptionItemIds.filter((v: unknown) => typeof v === "string")
      : [];
    if (itemIds.length === 0) {
      return error("Seleziona almeno un servizio da pagare", 400);
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { items: { where: { id: { in: itemIds } } } },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    if (subscription.items.length !== itemIds.length) {
      return error(
        "Uno o più servizi selezionati non appartengono all'abbonamento",
        400,
      );
    }
    // Importo unico → valuta unica.
    if (new Set(subscription.items.map((it) => it.currency)).size > 1) {
      return error(
        "I servizi selezionati hanno valute diverse: non è possibile un unico pagamento.",
        400,
      );
    }

    const items = subscription.items;
    const totalCents = items.reduce(
      (sum, it) => sum + it.priceCents * it.quantity,
      0,
    );
    const currency = items[0].currency;

    // Crea il Payment CONFERMATO con una PaymentItem per riga (periodo preview),
    // poi delega conferma+rinnovo+ricevuta alla funzione condivisa (idempotente).
    const created = await prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amountCents: totalCents,
        currency,
        method: "MANUALE",
        status: "CONFERMATO",
        paidAt: data.paidAt ?? new Date(),
        note: data.note,
        recordedById: session.sub,
        items: {
          create: items.map((it) => {
            const duration = periodDurationDays(it);
            return {
              subscriptionItemId: it.id,
              amountCents: it.priceCents * it.quantity,
              status: "IN_ATTESA" as const,
              periodStart: it.endDate,
              periodEnd:
                duration != null
                  ? new Date(it.endDate.getTime() + duration * MS_PER_DAY)
                  : null,
            };
          }),
        },
      },
    });

    const result = await confirmPaymentAndRenew(created.id);

    return json(
      {
        payment: result.payment,
        receipt: result.receipt,
        items: result.items,
      },
      201,
    );
  });
}
