import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { manualActivationSchema } from "@/lib/validations";
import {
  ActivationConflictError,
  manualPaymentNote,
  recordManualActivation,
} from "@/lib/activation";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/activate-manual — "Segna come pagato".
// Registra il primo pagamento come manuale (prezzi iniziali, date invariate),
// con ricevuta ed email di conferma, e attiva l'abbonamento.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireSession();
    const data = manualActivationSchema.parse(await req.json().catch(() => ({})));
    try {
      const result = await recordManualActivation(params.id, {
        paidAt: data.paidAt,
        note: manualPaymentNote(data.method, data.note),
        recordedById: session.sub,
      });
      await prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: "SUBSCRIPTION_ACTIVATED_MANUAL",
          entityType: "Subscription",
          entityId: params.id,
          details: {
            paymentId: result.payment.id,
            amountCents: result.payment.amountCents,
            receipt: result.receipt.number,
          },
        },
      });
      return json(
        { payment: result.payment, receipt: result.receipt, activation: result.activation },
        201,
      );
    } catch (e) {
      if (e instanceof ActivationConflictError) return error(e.message, 409);
      throw e;
    }
  });
}
