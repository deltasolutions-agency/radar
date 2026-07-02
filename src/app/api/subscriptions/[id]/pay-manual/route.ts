import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { manualPaymentSchema } from "@/lib/validations";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/pay-manual
// Registra un pagamento manuale (già incassato) e rinnova l'abbonamento.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    // recordedById proviene SEMPRE dalla sessione, mai dal body: garantisce la
    // tracciabilità di chi ha registrato il pagamento.
    const session = await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, currency: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const data = manualPaymentSchema.parse(await req.json());

    // Crea il Payment come CONFERMATO, poi delega conferma+rinnovo+ricevuta
    // alla funzione condivisa (idempotente).
    const created = await prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amountCents: data.amountCents,
        currency: subscription.currency,
        method: "MANUALE",
        status: "CONFERMATO",
        paidAt: data.paidAt ?? new Date(),
        note: data.note,
        recordedById: session.sub,
      },
    });

    const result = await confirmPaymentAndRenew(created.id);

    return json(
      {
        payment: result.payment,
        receipt: result.receipt,
        subscription: result.subscription,
        renewalSkipped: result.renewalSkipped,
        renewalReason: result.renewalReason,
      },
      201,
    );
  });
}
