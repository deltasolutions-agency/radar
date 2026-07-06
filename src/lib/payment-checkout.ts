import "server-only";
import type { Payment, BillingPeriod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/send-email";
import { buildPaymentLinkEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { addVatToNet } from "@/lib/vat";

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

  // Il prezzo inserito è NETTO: l'importo da incassare per ogni riga è il LORDO
  // (netto + 22%), calcolato sul totale riga (priceCents × quantity).
  const itemGrossCents = items.map(
    (it) => addVatToNet(it.priceCents * it.quantity).grossCents,
  );
  const servicesCents = itemGrossCents.reduce((sum, c) => sum + c, 0);
  // Costo di servizio 1,5% (solo Stripe) sul LORDO dei servizi.
  const serviceFeeCents = computeServiceFeeCents(servicesCents, serviceFeeEnabled);
  const amountCents = servicesCents + serviceFeeCents;
  const currency = items[0].currency;

  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  // Riga servizi + eventuale riga extra "Costi di servizio Radar" (non è un
  // PaymentItem: è solo una voce visibile nel checkout).
  // Una line_item per servizio: quantità 1 e unit_amount = LORDO del totale riga
  // (IVA inclusa), così l'importo Stripe coincide ESATTAMENTE con il PaymentItem
  // memorizzato. La quantità del servizio è indicata nel nome (×N).
  const lineItems = items.map((it, idx) => ({
    quantity: 1,
    price_data: {
      currency: it.currency,
      unit_amount: itemGrossCents[idx],
      product_data: {
        name: it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
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
  const paymentItemsData = items.map((it, idx) => {
    const duration = periodDurationDays(it);
    return {
      subscriptionItemId: it.id,
      amountCents: itemGrossCents[idx],
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
    // Il link può coprire più servizi: l'email li elenca al NETTO (IVA esclusa).
    // IVA, costo di servizio e totale sono mostrati sulla pagina /pay dopo il
    // click, quindi qui NON si includono né la riga costo servizio né il totale.
    const emailItems = items.map((it, idx) => ({
      serviceName:
        it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
      amountCents: it.priceCents * it.quantity,
      periodEnd: paymentItemsData[idx].periodEnd,
    }));
    const content = buildPaymentLinkEmail({
      items: emailItems,
      currency,
      checkoutUrl: payUrl,
      expiresAt,
    });
    const sent = await sendEmail(content, recipient);
    emailSent = sent.status === "INVIATA";
  }

  return { payment, url: session.url, expiresAt, emailSent, recipient };
}

/**
 * Crea una NUOVA Checkout Session per un Payment IN_ATTESA già esistente, con
 * l'opzione di ATTIVAZIONE del rinnovo automatico: salva il metodo di pagamento
 * per usi futuri (setup_future_usage) e marca la sessione con i metadata letti
 * dal webhook per attivare l'auto-charge sugli item pagati.
 *
 * Usata dalla pagina pubblica /pay quando il cliente spunta "Attiva anche il
 * rinnovo automatico". Aggiorna Payment.stripeCheckoutSessionId alla nuova
 * sessione (quella pre-creata viene abbandonata e scadrà). Richiede un Customer
 * Stripe (creato se assente), necessario per riusare la carta off_session.
 */
export async function createAutoChargeCheckoutSession(
  paymentId: string,
  appUrl: string,
): Promise<{ url: string | null; sessionId: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      subscription: { include: { client: true } },
      items: { include: { subscriptionItem: { include: { service: true } } } },
    },
  });
  if (!payment) throw new Error(`Payment ${paymentId} non trovato`);
  if (payment.items.length === 0) {
    throw new Error(`Payment ${paymentId} senza righe: nessuna sessione da creare`);
  }

  const stripe = getStripe();
  const client = payment.subscription.client;

  // Customer obbligatorio per conservare il metodo di pagamento (off_session).
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

  const currency = payment.currency;
  // Righe = importi GIÀ memorizzati (lordi) nei PaymentItem + eventuale fee.
  const lineItems = payment.items.map((pi) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: pi.amountCents,
      product_data: {
        name:
          pi.subscriptionItem.quantity > 1
            ? `${pi.subscriptionItem.service.name} ×${pi.subscriptionItem.quantity}`
            : pi.subscriptionItem.service.name,
        ...(pi.subscriptionItem.service.description
          ? { description: pi.subscriptionItem.service.description }
          : {}),
      },
    },
  }));
  if (payment.serviceFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: payment.serviceFeeCents,
        product_data: {
          name: "Costi di servizio Radar",
          description: "Commissione di gestione pagamento (1,5%)",
        },
      },
    });
  }

  const itemIds = payment.items.map((pi) => pi.subscriptionItemId);
  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: expiresAtUnix,
    customer: customerId,
    line_items: lineItems,
    // Conserva la carta per gli addebiti automatici futuri (off_session).
    payment_intent_data: { setup_future_usage: "off_session" },
    success_url: `${appUrl}/pay/grazie`,
    cancel_url: `${appUrl}/pay/grazie?annullato=1`,
    metadata: {
      subscriptionId: payment.subscriptionId,
      activateAutoCharge: "true",
      autoChargeItemIds: JSON.stringify(itemIds),
    },
  });

  const expiresAt = new Date((session.expires_at ?? expiresAtUnix) * 1000);
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      stripeCheckoutSessionId: session.id,
      checkoutExpiresAt: expiresAt,
    },
  });

  return { url: session.url, sessionId: session.id };
}
