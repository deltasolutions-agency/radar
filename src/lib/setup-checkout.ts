import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

type ClientForSetup = {
  id: string;
  email: string | null;
  name: string;
  stripeCustomerId: string | null;
};

/**
 * Crea una Stripe Checkout Session mode:'setup' per registrare la carta del
 * cliente (addebiti automatici). Crea il customer Stripe se manca. Ritorna
 * l'URL della sessione. success/cancel puntano alla pagina pubblica
 * /attiva-rinnovo/{token} (il cliente non è autenticato).
 *
 * I metadata includono `requestId` (AutoChargeRequest) così il webhook attiva il
 * rinnovo automatico SOLO sugli item di quella richiesta, non su tutti.
 */
export async function createSetupCheckoutUrl(
  params: {
    client: ClientForSetup;
    currency: string;
    token: string;
    requestId: string;
  },
  appUrl: string,
): Promise<string | null> {
  const stripe = getStripe();
  const { client, currency, token, requestId } = params;

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
    currency,
    customer: customerId,
    success_url: `${appUrl}/attiva-rinnovo/${token}?done=1`,
    cancel_url: `${appUrl}/attiva-rinnovo/${token}?annullato=1`,
    metadata: { clientId: client.id, requestId },
  });

  return session.url;
}
