import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";

type Params = { params: { id: string } };

// POST /api/payments/[id]/cancel-activation — "Annulla pagamento di
// attivazione" per i primi pagamenti MANUALI (che non passano da Stripe e non
// hanno lo storno). Il pagamento risulta stornato (righe e ricevuta), le date
// non cambiano e l'abbonamento torna in attesa del primo pagamento. Gli storni
// esistenti (Stripe) restano invariati. Registrato in AdminActionLog.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireSession();
    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: { items: { select: { id: true, status: true } } },
    });
    if (!payment) return error("Pagamento non trovato", 404);
    if (payment.kind !== "ACTIVATION" || payment.method !== "MANUALE") {
      return error("Si annullano così solo i primi pagamenti manuali", 400);
    }
    if (payment.status !== "CONFERMATO") {
      return error("Il pagamento non è confermato", 409);
    }
    const later = await prisma.payment.findFirst({
      where: {
        subscriptionId: payment.subscriptionId,
        id: { not: payment.id },
        status: "CONFERMATO",
        createdAt: { gt: payment.createdAt },
      },
      select: { id: true },
    });
    if (later) {
      return error(
        "Non è possibile annullare il primo pagamento: l'abbonamento ha pagamenti successivi.",
        409,
      );
    }

    await prisma.$transaction([
      prisma.paymentItem.updateMany({
        where: { paymentId: payment.id, status: "CONFERMATO" },
        data: { status: "RIMBORSATO" },
      }),
      prisma.payment.update({ where: { id: payment.id }, data: { status: "RIMBORSATO" } }),
      prisma.subscription.update({
        where: { id: payment.subscriptionId },
        data: { activationState: "PENDING_FIRST_PAYMENT", firstPaymentLinkSentAt: null },
      }),
      prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: "ACTIVATION_PAYMENT_CANCELLED",
          entityType: "Payment",
          entityId: payment.id,
          details: {
            subscriptionId: payment.subscriptionId,
            amountCents: payment.amountCents,
            before: { status: payment.status, activationState: "ACTIVE" },
            after: { status: "RIMBORSATO", activationState: "PENDING_FIRST_PAYMENT" },
          },
        },
      }),
    ]);
    return json({ ok: true });
  });
}
