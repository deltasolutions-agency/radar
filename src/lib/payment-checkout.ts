import "server-only";
import type { Payment, BillingPeriod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/send-email";
import { buildPaymentLinkEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { computeServiceFeeCents } from "@/lib/service-fee";

// Durata di validità della Checkout Session. Stripe impone un MASSIMO di 24h
// da expires_at: usiamo 23h per lasciare margine contro arrotondamenti/latenza
// (all'utente comunichiamo 24h per semplicità).
const CHECKOUT_TTL_SECONDS = 23 * 60 * 60;

/** Riga di servizio da includere nel pagamento (una per PaymentItem/line_item). */
export type SubscriptionItemForCheckout = {
  id: string;
  currency: string;
  priceCents: number; // prezzo UNITARIO
  quantity: number; // ≥ 1: il totale riga è priceCents × quantity
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
  /** Se true, aggiunge il costo di servizio Radar (1,5%) — solo Stripe. */
  serviceFeeEnabled: boolean;
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
  const { subscriptionId, clientEmail, items, serviceFeeEnabled } = request;

  if (items.length === 0) {
    throw new Error("createCheckoutPayment: nessuna riga di servizio fornita");
  }

  const stripe = getStripe();

  const servicesCents = items.reduce(
    (sum, it) => sum + it.priceCents * it.quantity,
    0,
  );
  // Costo di servizio 1,5% (solo Stripe): questo flusso è sempre Stripe.
  const serviceFeeCents = computeServiceFeeCents(servicesCents, serviceFeeEnabled);
  const amountCents = servicesCents + serviceFeeCents;
  const currency = items[0].currency;

  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  // Riga servizi + eventuale riga extra "Costi di servizio Radar" (non è un
  // PaymentItem: è solo una voce visibile nel checkout).
  const lineItems = items.map((it) => ({
    quantity: it.quantity,
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
  }));
  if (serviceFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: serviceFeeCents,
        product_data: {
          name: "Costi di servizio Radar",
          description: "Commissione di gestione pagamento (1,5%)",
        },
      },
    });
  }

  // Flusso self-service (link al cliente): success/cancel puntano alla pagina
  // pubblica di ringraziamento (il cliente NON è autenticato, non deve finire
  // nella dashboard admin). Flusso diretto admin ("Apri checkout ora"): resta il
  // dettaglio dell'abbonamento in dashboard.
  const successUrl = opts.sendToClient
    ? `${appUrl}/pay/grazie`
    : `${appUrl}/abbonamenti/${subscriptionId}?payment=success`;
  const cancelUrl = opts.sendToClient
    ? `${appUrl}/pay/grazie?annullato=1`
    : `${appUrl}/abbonamenti/${subscriptionId}?payment=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: expiresAtUnix,
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
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
      amountCents: it.priceCents * it.quantity,
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
      serviceFeeCents,
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
    const emailItems = items.map((it, idx) => ({
      serviceName:
        it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
      amountCents: it.priceCents * it.quantity,
      periodEnd: paymentItemsData[idx].periodEnd,
    }));
    if (serviceFeeCents > 0) {
      emailItems.push({
        serviceName: "Costi di servizio (1,5%)",
        amountCents: serviceFeeCents,
        periodEnd: null,
      });
    }
    const content = buildPaymentLinkEmail({
      items: emailItems,
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
