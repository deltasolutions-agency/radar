import "server-only";
import type {
  Payment,
  PaymentKind,
  BillingPeriod,
  EmailTrigger,
  Service,
  SubscriptionItem,
} from "@prisma/client";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/send-email";
import { buildPaymentLinkEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { addVatToNet } from "@/lib/vat";
import { withEndClient } from "@/lib/end-client";
import {
  langOf,
  localizedServiceDescription,
  localizedServiceName,
  stripeLocale,
  tr,
  type Lang,
} from "@/lib/i18n";

// Durata di validità della Checkout Session. Stripe impone un MASSIMO di 24h
// da expires_at: usiamo 23h per lasciare margine contro arrotondamenti/latenza
// (all'utente non comunichiamo una scadenza: /pay rigenera la sessione scaduta
// al click, quindi il link resta valido fino al pagamento).
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
  service: {
    name: string;
    description: string | null;
    nameEn?: string | null;
    descriptionEn?: string | null;
  };
  /** Cliente finale della riga: aggiunto al nome su Stripe e nell'email. */
  endClientName: string | null;
  /**
   * Periodo coperto esplicito (pagamento di attivazione: inizio → fine del
   * form). Assente = rinnovo: da endDate a endDate + durata.
   */
  period?: { start: Date; end: Date };
};

/**
 * Riga di checkout da una SubscriptionItem: prezzo = prezzo del PROSSIMO
 * rinnovo (renewalChargePriceCents: aumentato per EVERY_RENEWAL e per ONCE non
 * ancora applicato).
 */
export function toCheckoutItem(
  it: Omit<SubscriptionItem, "service"> & { service: Service },
): SubscriptionItemForCheckout {
  return {
    id: it.id,
    currency: it.currency,
    priceCents: renewalChargePriceCents(it),
    quantity: it.quantity,
    endDate: it.endDate,
    billingPeriod: it.billingPeriod,
    customPeriodDays: it.customPeriodDays,
    service: {
      name: it.service.name,
      description: it.service.description,
      nameEn: it.service.nameEn,
      descriptionEn: it.service.descriptionEn,
    },
    endClientName: it.endClientName,
  };
}

/** Riga extra "Costi di servizio Radar" nella lingua del cliente (importo invariato). */
function serviceFeeProductData(lang: Lang): { name: string; description: string } {
  return {
    name: tr(lang, { it: "Costi di servizio Radar", en: "Radar service costs" }),
    description: tr(lang, {
      it: "Commissione di gestione pagamento (1,5%)",
      en: "Payment handling fee (1.5%)",
    }),
  };
}

/** Suffisso `lang=en` per gli URL di /pay/grazie (nessuno per l'italiano). */
function thanksUrl(appUrl: string, lang: Lang, cancelled: boolean): string {
  const params: string[] = [];
  if (cancelled) params.push("annullato=1");
  if (lang === "en") params.push("lang=en");
  return `${appUrl}/pay/grazie${params.length ? `?${params.join("&")}` : ""}`;
}

/** Nome riga Stripe: servizio localizzato (×N) + " – cliente finale". */
function checkoutLineName(
  service: { name: string; nameEn?: string | null },
  quantity: number,
  endClientName: string | null,
  lang: Lang,
): string {
  const name = localizedServiceName(service, lang);
  return withEndClient(quantity > 1 ? `${name} ×${quantity}` : name, endClientName);
}

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
  /** RENEWAL (default) o ACTIVATION (primo pagamento). */
  kind?: PaymentKind;
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
  opts: {
    sendToClient: boolean;
    /** Chi ha innescato l'invio del link (per EmailLog). Default MANUAL. */
    trigger?: EmailTrigger;
  },
): Promise<CheckoutResult> {
  const { subscriptionId, clientEmail, items, serviceFeeEnabled } = request;
  const kind = request.kind ?? "RENEWAL";

  if (items.length === 0) {
    throw new Error("createCheckoutPayment: nessuna riga di servizio fornita");
  }

  const stripe = getStripe();

  // Lingua del cliente (Stripe Checkout, righe, URL di ritorno, email).
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { clientId: true, client: { select: { locale: true } } },
  });
  const lang = langOf(sub?.client.locale);
  // I chiamanti possono non fornire nameEn/descriptionEn: per l'inglese si
  // leggono dal DB (solo testo, importi invariati).
  let services = items.map((it) => it.service);
  if (lang === "en" && items.some((it) => it.service.nameEn === undefined)) {
    const rows = await prisma.subscriptionItem.findMany({
      where: { id: { in: items.map((it) => it.id) } },
      select: { id: true, service: { select: { nameEn: true, descriptionEn: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r.service]));
    services = items.map((it) => ({ ...it.service, ...(byId.get(it.id) ?? {}) }));
  }

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
  const lineItems = items.map((it, idx) => {
    const description = localizedServiceDescription(services[idx], lang);
    return {
      quantity: 1,
      price_data: {
        currency: it.currency,
        unit_amount: itemGrossCents[idx],
        product_data: {
          // Solo testo: " – {cliente finale}" in coda al nome (importi invariati).
          name: checkoutLineName(services[idx], it.quantity, it.endClientName, lang),
          ...(description ? { description } : {}),
        },
      },
    };
  });
  if (serviceFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: serviceFeeCents,
        product_data: serviceFeeProductData(lang),
      },
    });
  }

  // Flusso self-service (link al cliente): success/cancel puntano alla pagina
  // pubblica di ringraziamento (il cliente NON è autenticato, non deve finire
  // nella dashboard admin). Flusso diretto admin ("Apri checkout ora"): resta il
  // dettaglio dell'abbonamento in dashboard.
  const successUrl = opts.sendToClient
    ? thanksUrl(appUrl, lang, false)
    : `${appUrl}/abbonamenti/${subscriptionId}?payment=success`;
  const cancelUrl = opts.sendToClient
    ? thanksUrl(appUrl, lang, true)
    : `${appUrl}/abbonamenti/${subscriptionId}?payment=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: stripeLocale(lang),
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
    if (it.period) {
      return {
        subscriptionItemId: it.id,
        amountCents: itemGrossCents[idx],
        status: "IN_ATTESA" as const,
        periodStart: it.period.start,
        periodEnd: it.period.end,
      };
    }
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
      kind,
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
    const emailItems = items.map((it, idx) => {
      const name = localizedServiceName(services[idx], lang);
      return {
        serviceName: it.quantity > 1 ? `${name} ×${it.quantity}` : name,
        endClientName: it.endClientName,
        amountCents: it.priceCents * it.quantity,
        periodEnd: paymentItemsData[idx].periodEnd,
      };
    });
    const content = buildPaymentLinkEmail({
      items: emailItems,
      currency,
      checkoutUrl: payUrl,
      lang,
    });
    const sent = await sendEmail(content, recipient, {
      type: "PAYMENT_LINK",
      trigger: opts.trigger ?? "MANUAL",
      clientId: sub?.clientId ?? null,
      subscriptionId,
      itemIds: items.map((it) => it.id),
    });
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
  const lang = langOf(client.locale);

  // Customer obbligatorio per conservare il metodo di pagamento (off_session).
  let customerId = client.stripeCustomerId;
  if (!customerId) {
    if (!client.email) {
      throw new Error("Cliente senza email: impossibile registrare la carta");
    }
    const customer = await stripe.customers.create({
      email: client.email,
      name: client.name,
      preferred_locales: [stripeLocale(lang)],
    });
    customerId = customer.id;
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const currency = payment.currency;
  // Righe = importi GIÀ memorizzati (lordi) nei PaymentItem + eventuale fee.
  const lineItems = payment.items.map((pi) => {
    const service = pi.subscriptionItem.service;
    const description = localizedServiceDescription(service, lang);
    return {
      quantity: 1,
      price_data: {
        currency,
        unit_amount: pi.amountCents,
        product_data: {
          name: checkoutLineName(
            service,
            pi.subscriptionItem.quantity,
            pi.subscriptionItem.endClientName,
            lang,
          ),
          ...(description ? { description } : {}),
        },
      },
    };
  });
  if (payment.serviceFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: payment.serviceFeeCents,
        product_data: serviceFeeProductData(lang),
      },
    });
  }

  const itemIds = payment.items.map((pi) => pi.subscriptionItemId);
  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: expiresAtUnix,
    locale: stripeLocale(lang),
    customer: customerId,
    line_items: lineItems,
    // Conserva la carta per gli addebiti automatici futuri (off_session).
    payment_intent_data: { setup_future_usage: "off_session" },
    success_url: thanksUrl(appUrl, lang, false),
    cancel_url: thanksUrl(appUrl, lang, true),
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

/**
 * true se il link di pagamento di questo Payment è SCADUTO ma rigenerabile:
 * pagamento Stripe da Checkout (non un addebito automatico), sessione scaduta
 * (IN_ATTESA oltre la scadenza, oppure FALLITO dal webhook di scadenza senza
 * altre note), righe ancora in attesa, scadenze delle righe non avanzate da un
 * altro pagamento e nessun altro pagamento attivo per lo stesso periodo.
 */
export async function canRegenerateCheckout(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      subscription: { select: { activationState: true } },
      items: { include: { subscriptionItem: { select: { endDate: true, startDate: true } } } },
    },
  });
  if (!payment || payment.method !== "STRIPE" || !payment.stripeCheckoutSessionId) {
    return false;
  }
  const isActivation = payment.kind === "ACTIVATION";
  // Primo pagamento: rigenerabile solo finché l'abbonamento è in attesa.
  if (isActivation && payment.subscription.activationState !== "PENDING_FIRST_PAYMENT") {
    return false;
  }
  const expired =
    payment.checkoutExpiresAt != null && payment.checkoutExpiresAt.getTime() < Date.now();
  const statusOk =
    payment.status === "IN_ATTESA" || (payment.status === "FALLITO" && !payment.note);
  if (!expired || !statusOk || payment.items.length === 0) return false;

  for (const pi of payment.items) {
    if (pi.status !== "IN_ATTESA") return false;
    // La riga è stata rinnovata nel frattempo (da un altro pagamento). Per il
    // primo pagamento il periodo parte dalla data di inizio della riga.
    const expectedStart = isActivation
      ? pi.subscriptionItem.startDate
      : pi.subscriptionItem.endDate;
    if (!pi.periodStart || expectedStart.getTime() !== pi.periodStart.getTime()) {
      return false;
    }
    const other = await prisma.paymentItem.findFirst({
      where: {
        subscriptionItemId: pi.subscriptionItemId,
        periodStart: pi.periodStart,
        paymentId: { not: payment.id },
        payment: { status: { in: ["IN_ATTESA", "CONFERMATO"] } },
      },
      select: { id: true },
    });
    if (other) return false;
  }
  return true;
}

/**
 * Rigenera la Checkout Session di un Payment con link scaduto: STESSO Payment,
 * STESSI importi (line item dai PaymentItem memorizzati + eventuale costo di
 * servizio memorizzato), nuova scadenza ~24h. Il Payment torna IN_ATTESA.
 * Il chiamante deve aver verificato canRegenerateCheckout().
 */
export async function regenerateCheckoutSession(
  paymentId: string,
  appUrl: string,
): Promise<{ url: string | null }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      subscription: { include: { client: true } },
      items: { include: { subscriptionItem: { include: { service: true } } } },
    },
  });
  if (!payment) throw new Error(`Payment ${paymentId} non trovato`);
  const lang = langOf(payment.subscription.client.locale);

  const currency = payment.currency;
  const lineItems = payment.items.map((pi) => {
    const service = pi.subscriptionItem.service;
    const description = localizedServiceDescription(service, lang);
    return {
      quantity: 1,
      price_data: {
        currency,
        unit_amount: pi.amountCents,
        product_data: {
          name: checkoutLineName(
            service,
            pi.subscriptionItem.quantity,
            pi.subscriptionItem.endClientName,
            lang,
          ),
          ...(description ? { description } : {}),
        },
      },
    };
  });
  if (payment.serviceFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: payment.serviceFeeCents,
        product_data: serviceFeeProductData(lang),
      },
    });
  }

  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS;
  const clientEmail = payment.subscription.client.email;
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    locale: stripeLocale(lang),
    expires_at: expiresAtUnix,
    line_items: lineItems,
    success_url: thanksUrl(appUrl, lang, false),
    cancel_url: thanksUrl(appUrl, lang, true),
    ...(clientEmail ? { customer_email: clientEmail } : {}),
    metadata: { subscriptionId: payment.subscriptionId },
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "IN_ATTESA",
      stripeCheckoutSessionId: session.id,
      checkoutExpiresAt: new Date((session.expires_at ?? expiresAtUnix) * 1000),
    },
  });
  return { url: session.url };
}
