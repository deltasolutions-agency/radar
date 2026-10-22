import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { ActivationConflictError, invalidatePendingActivation } from "@/lib/activation";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/cancel-pending — "Annulla abbonamento in attesa".
// Non cancella nulla: stato CANCELLED_BEFORE_START, link di pagamento
// invalidato, escluso da tutto. Registrato in AdminActionLog.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireSession();
    const sub = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, activationState: true, firstPaymentLinkSentAt: true },
    });
    if (!sub) return error("Abbonamento non trovato", 404);
    if (sub.activationState !== "PENDING_FIRST_PAYMENT") {
      return error("Si annullano solo abbonamenti in attesa del primo pagamento", 409);
    }
    let invalidated: number;
    try {
      invalidated = await invalidatePendingActivation(sub.id, "abbonamento annullato");
    } catch (e) {
      if (e instanceof ActivationConflictError) return error(e.message, 409);
      throw e;
    }
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: sub.id },
        data: { activationState: "CANCELLED_BEFORE_START" },
      }),
      prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: "SUBSCRIPTION_CANCELLED_BEFORE_START",
          entityType: "Subscription",
          entityId: sub.id,
          details: {
            before: { activationState: sub.activationState, firstPaymentLinkSentAt: sub.firstPaymentLinkSentAt?.toISOString() ?? null },
            after: { activationState: "CANCELLED_BEFORE_START", firstPaymentLinkSentAt: null },
            invalidatedPayments: invalidated,
          },
        },
      }),
    ]);
    return json({ ok: true });
  });
}
