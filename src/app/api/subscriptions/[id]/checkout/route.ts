import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { getStripe } from "@/lib/stripe";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/checkout
// Crea una Stripe Checkout Session (mode: payment) per l'importo corrente
// dell'abbonamento e un Payment IN_ATTESA collegato.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { service: true, client: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: subscription.currency,
            unit_amount: subscription.priceCents,
            product_data: {
              name: subscription.service.name,
              ...(subscription.service.description
                ? { description: subscription.service.description }
                : {}),
            },
          },
        },
      ],
      success_url: `${appUrl}/abbonamenti/${subscription.id}?payment=success`,
      cancel_url: `${appUrl}/abbonamenti/${subscription.id}?payment=cancelled`,
      ...(subscription.client.email
        ? { customer_email: subscription.client.email }
        : {}),
      metadata: { subscriptionId: subscription.id },
    });

    await prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amountCents: subscription.priceCents,
        currency: subscription.currency,
        method: "STRIPE",
        status: "IN_ATTESA",
        stripeCheckoutSessionId: session.id,
      },
    });

    return json({ url: session.url });
  });
}
