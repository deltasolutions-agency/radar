import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

type SubscriptionForSetup = {
  id: string;
  currency: string;
  client: {
    id: string;
    email: string | null;
    name: string;
    stripeCustomerId: string | null;
  };
};

/**
 * Crea una Stripe Checkout Session mode:'setup' per registrare la carta del
 * cliente (addebiti automatici). Crea il customer Stripe se manca. Ritorna
 * l'URL della sessione. success/cancel puntano alla pagina pubblica
 * /attiva-rinnovo/{token} (il cliente non è autenticato).
 */
export async function createSetupCheckoutUrl(
  subscription: SubscriptionForSetup,
  appUrl: string,
  token: string,
): Promise<string | null> {
  const stripe = getStripe();
  const client = subscription.client;

  let customerId = client.stripeCustomerId;
  if (!customerId) {
    if (!client.email) {
      throw new Error("Cliente senza email: impossibile registrare la carta");
    }
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
    // mode:'setup' non ha line_items ma Stripe richiede comunque currency.
    currency: subscription.currency,
    customer: customerId,
    success_url: `${appUrl}/attiva-rinnovo/${token}?done=1`,
    cancel_url: `${appUrl}/attiva-rinnovo/${token}?annullato=1`,
    metadata: { subscriptionId: subscription.id, clientId: client.id },
  });

  return session.url;
}
