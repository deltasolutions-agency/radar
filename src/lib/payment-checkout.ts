import "server-only";
import type { Payment, BillingPeriod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/send-email";
import { buildPaymentLinkEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";

// Durata di validità della Checkout Session. Stripe impone un MASSIMO di 24h
// da expires_at: usiamo 23h per lasciare margine contro arrotondamenti/latenza
// (all'utente comunichiamo 24h per semplicità).
const CHECKOUT_TTL_SECONDS = 23 * 60 * 60;

export type SubscriptionForCheckout = {
  id: string;
  currency: string;
  priceCents: number;
  endDate: Date;
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
  service: { name: string; description: string | null };
  client: { email: string | null };
};

export type CheckoutResult = {
  payment: Payment;
  url: string | null;
  expiresAt: Date;
  /** true se richiesto l'invio al cliente ed esso è andato a buon fine. */
  emailSent: boolean;
  recipient: string | null;
};

/**
 * Crea una Stripe Checkout Session (mode payment, scadenza ~24h) e il relativo
 * Payment IN_ATTESA. Se opts.sendToClient è true, invia al cliente l'email col
 * link reale della sessione e valorizza linkSentAt.
 *
 * Riusata sia dal bottone "Invia link" / "Apri checkout" (Step 6.3) sia dalla
 * rigenerazione del link scaduto (Step 6.4).
 */
export async function createCheckoutPayment(
  subscription: SubscriptionForCheckout,
  appUrl: string,
  opts: { sendToClient: boolean },
): Promise<CheckoutResult> {
  const stripe = getStripe();

  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: expiresAtUnix,
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

  // expires_at è restituito da Stripe (fallback al valore inviato).
  const expiresAt = new Date((session.expires_at ?? expiresAtUnix) * 1000);

  // Periodo coperto: da endDate corrente alla scadenza dopo il rinnovo.
  const duration = periodDurationDays(subscription);
  const periodStart = subscription.endDate;
  const periodEnd =
    duration != null
      ? new Date(subscription.endDate.getTime() + duration * MS_PER_DAY)
      : null;

  const payment = await prisma.payment.create({
    data: {
      subscriptionId: subscription.id,
      amountCents: subscription.priceCents,
      currency: subscription.currency,
      method: "STRIPE",
      status: "IN_ATTESA",
      stripeCheckoutSessionId: session.id,
      checkoutExpiresAt: expiresAt,
      linkSentAt: opts.sendToClient ? new Date() : null,
      periodStart,
      periodEnd,
    },
  });

  let emailSent = false;
  let recipient: string | null = null;

  if (opts.sendToClient && subscription.client.email && session.url) {
    recipient = subscription.client.email;
    const content = buildPaymentLinkEmail({
      serviceName: subscription.service.name,
      amountCents: subscription.priceCents,
      currency: subscription.currency,
      periodStart,
      periodEnd,
      checkoutUrl: session.url,
      expiresAt,
    });
    const sent = await sendEmail(content, recipient);
    emailSent = sent.status === "INVIATA";
  }

  return { payment, url: session.url, expiresAt, emailSent, recipient };
}
