import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { getStripe } from "@/lib/stripe";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/setup-auto-charge
// Avvia la registrazione della carta per gli addebiti automatici: crea (se
// serve) il customer Stripe e una Checkout Session mode:'setup'. Ritorna { url }
// per il redirect admin (flusso interno assistito).
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { client: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    const client = subscription.client;
    if (!client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile registrare la carta.",
        400,
      );
    }

    const stripe = getStripe();

    // Crea il customer Stripe se non esiste ancora.
    let customerId = client.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: client.email,
        name: client.name,
      });
      customerId = customer.id;
      await prisma.client.update({
        where: { id: client.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      success_url: `${appUrl}/abbonamenti/${subscription.id}?setup=success`,
      cancel_url: `${appUrl}/abbonamenti/${subscription.id}?setup=cancelled`,
      metadata: { subscriptionId: subscription.id, clientId: client.id },
    });

    return json({ url: session.url });
  });
}
