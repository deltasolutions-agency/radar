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

/** Riga di servizio da includere nel pagamento (una per PaymentItem/line_item). */
export type SubscriptionItemForCheckout = {
  id: string;
  currency: string;
  priceCents: number;
  endDate: Date;
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
  service: { name: string; description: string | null };
};

/**
 * Richiesta di checkout: l'abbonamento contenitore + le righe (con scadenza
 * comune) da raggruppare in un unico addebito.
 */
export type CheckoutRequest = {
  subscriptionId: string;
  clientEmail: string | null;
  items: SubscriptionItemForCheckout[];
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
 * Payment IN_ATTESA con un PaymentItem per ciascuna riga di servizio.
 *
 * - amountCents totale = somma dei priceCents delle righe.
 * - Stripe Checkout: UNA line_item per servizio (il cliente vede il dettaglio),
 *   il totale è calcolato da Stripe sommando le righe.
 * - Ogni PaymentItem: amountCents = priceCents della riga, periodStart = endDate
 *   corrente della riga, periodEnd = endDate + durata (preview; il rinnovo
 *   definitivo avviene in confirm-payment, indipendente per riga).
 *
 * Riusata sia dal bottone "Invia link" / "Apri checkout" sia dalla
 * rigenerazione del link scaduto.
 */
export async function createCheckoutPayment(
  request: CheckoutRequest,
  appUrl: string,
  opts: { sendToClient: boolean },
): Promise<CheckoutResult> {
  const { subscriptionId, clientEmail, items } = request;

  if (items.length === 0) {
    throw new Error("createCheckoutPayment: nessuna riga di servizio fornita");
  }

  const stripe = getStripe();

  const amountCents = items.reduce((sum, it) => sum + it.priceCents, 0);
  const currency = items[0].currency;

  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: expiresAtUnix,
    line_items: items.map((it) => ({
      quantity: 1,
      price_data: {
        currency: it.currency,
        unit_amount: it.priceCents,
        product_data: {
          name: it.service.name,
          ...(it.service.description
            ? { description: it.service.description }
            : {}),
        },
      },
    })),
    success_url: `${appUrl}/abbonamenti/${subscriptionId}?payment=success`,
    cancel_url: `${appUrl}/abbonamenti/${subscriptionId}?payment=cancelled`,
    ...(clientEmail ? { customer_email: clientEmail } : {}),
    metadata: { subscriptionId },
  });

  // expires_at è restituito da Stripe (fallback al valore inviato).
  const expiresAt = new Date((session.expires_at ?? expiresAtUnix) * 1000);

  // Periodo coperto da ciascuna riga: da endDate corrente alla scadenza dopo il
  // rinnovo (preview — la conferma definitiva è in confirm-payment).
  const paymentItemsData = items.map((it) => {
    const duration = periodDurationDays(it);
    return {
      subscriptionItemId: it.id,
      amountCents: it.priceCents,
      status: "IN_ATTESA" as const,
      periodStart: it.endDate,
      periodEnd:
        duration != null
          ? new Date(it.endDate.getTime() + duration * MS_PER_DAY)
          : null,
    };
  });

  const payment = await prisma.payment.create({
    data: {
      subscriptionId,
      amountCents,
      currency,
      method: "STRIPE",
      status: "IN_ATTESA",
      stripeCheckoutSessionId: session.id,
      checkoutExpiresAt: expiresAt,
      linkSentAt: opts.sendToClient ? new Date() : null,
      items: { create: paymentItemsData },
    },
  });

  let emailSent = false;
  let recipient: string | null = null;

  if (opts.sendToClient && clientEmail && session.url) {
    recipient = clientEmail;
    // Il cliente riceve il link alla pagina intermedia con gate di consenso,
    // NON direttamente l'URL Stripe (quello resta per il flusso admin diretto).
    const payUrl = `${appUrl}/pay/${payment.payToken}`;
    // Il link può coprire più servizi: l'email li elenca con importo e periodo.
    const content = buildPaymentLinkEmail({
      items: items.map((it, idx) => ({
        serviceName: it.service.name,
        amountCents: it.priceCents,
        periodEnd: paymentItemsData[idx].periodEnd,
      })),
      totalCents: amountCents,
      currency,
      checkoutUrl: payUrl,
      expiresAt,
    });
    const sent = await sendEmail(content, recipient);
    emailSent = sent.status === "INVIATA";
  }

  return { payment, url: session.url, expiresAt, emailSent, recipient };
}
