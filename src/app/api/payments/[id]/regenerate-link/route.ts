import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { createCheckoutPayment } from "@/lib/payment-checkout";

type Params = { params: { id: string } };

// POST /api/payments/[id]/regenerate-link
// Il vecchio link Stripe è scaduto senza pagamento: marca il Payment come
// FALLITO, crea una NUOVA Checkout Session (72h) + Payment IN_ATTESA e reinvia
// il link al cliente.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: {
        subscription: { include: { service: true, client: true } },
      },
    });
    if (!payment) return error("Pagamento non trovato", 404);

    if (payment.method !== "STRIPE") {
      return error("Solo i pagamenti Stripe hanno un link da rigenerare", 400);
    }
    if (payment.status !== "IN_ATTESA") {
      return error(
        `Impossibile rigenerare: il pagamento è in stato ${payment.status}.`,
        409,
      );
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    const { subscription } = payment;
    if (!subscription.client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile inviare il link.",
        400,
      );
    }

    // Marca il vecchio Payment come FALLITO (solo se ancora IN_ATTESA: evita di
    // sovrascrivere un pagamento confermato nel frattempo).
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "IN_ATTESA" },
      data: { status: "FALLITO" },
    });

    // Nuova sessione + nuovo Payment + invio email al cliente.
    const result = await createCheckoutPayment(subscription, appUrl, {
      sendToClient: true,
    });

    return json(
      {
        payment: result.payment,
        sent: result.emailSent,
        recipient: result.recipient,
        expiresAt: result.expiresAt,
      },
      201,
    );
  });
}
