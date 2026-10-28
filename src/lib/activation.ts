import "server-only";
import type { EmailTrigger, Service, SubscriptionItem } from "@prisma/client";
import { langOf, localizedServiceName, type Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/send-email";
import { addVatToNet } from "@/lib/vat";
import {
  buildFirstPaymentEmail,
  type FirstPaymentBlock,
  type FirstPaymentEmailItem,
} from "@/lib/email-templates";
import {
  createCheckoutPayment,
  type SubscriptionItemForCheckout,
} from "@/lib/payment-checkout";
import { confirmPaymentAndRenew, type ConfirmPaymentResult } from "@/lib/confirm-payment";
import { sendWelcomeEmail, WELCOME_CLIENT_SELECT } from "@/lib/welcome-email";

// Abbonamenti "da pagare": nascono in attesa del primo pagamento (attivazione)
// e diventano attivi alla sua conferma. Finché non sono ACTIVE sono esclusi da
// cron, conteggi e grafici: tutti i punti usano i filtri qui sotto.

export {
  ACTIVE_ITEM_WHERE,
  ACTIVE_SUBSCRIPTION_WHERE,
  ACTIVATION_STATE_LABELS,
  notActiveMessage,
} from "@/lib/activation-state";

/** Nota sui pagamenti di attivazione resi non più pagabili (blocca la rigenerazione). */
const INVALIDATED_NOTE_PREFIX = "Link primo pagamento invalidato";

type ItemWithService = SubscriptionItem & { service: Service };

/** Imponibile del primo pagamento: prezzo iniziale × quantità, NESSUN aumento. */
export function activationNetCents(it: Pick<SubscriptionItem, "priceCents" | "quantity">): number {
  return it.priceCents * it.quantity;
}

/** Riga di checkout del primo pagamento: prezzo iniziale, periodo inizio → fine. */
export function toActivationCheckoutItem(it: ItemWithService): SubscriptionItemForCheckout {
  return {
    id: it.id,
    currency: it.currency,
    priceCents: it.priceCents,
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
    period: { start: it.startDate, end: it.endDate },
  };
}

/** Righe pagabili con il primo pagamento (le cessate non si attivano). */
function activationItems<T extends { status: string }>(items: T[]): T[] {
  return items.filter((it) => it.status !== "CESSATO");
}

/** Voci per le email del primo pagamento (nomi nella lingua del cliente). */
export function firstPaymentEmailItems(
  items: ItemWithService[],
  lang: Lang = "it",
): FirstPaymentEmailItem[] {
  return items.map((it) => {
    const name = localizedServiceName(it.service, lang);
    return {
      serviceName: it.quantity > 1 ? `${name} ×${it.quantity}` : name,
      endClientName: it.endClientName,
      netCents: activationNetCents(it),
      startDate: it.startDate,
      endDate: it.endDate,
    };
  });
}

/**
 * Pagamento di attivazione ancora pagabile: in attesa, oppure scaduto dal
 * webhook senza note (rigenerabile da /pay). null se non esiste o è stato
 * invalidato.
 */
export function findPayableActivationPayment(subscriptionId: string) {
  return prisma.payment.findFirst({
    where: {
      subscriptionId,
      kind: "ACTIVATION",
      method: "STRIPE",
      OR: [{ status: "IN_ATTESA" }, { status: "FALLITO", note: null }],
    },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
}

/**
 * Chiude (best effort) le sessioni Stripe dei pagamenti indicati. Ritorna gli
 * id dei pagamenti la cui sessione risulta GIÀ PAGATA: il chiamante deve
 * fermarsi (il webhook confermerà il pagamento).
 */
async function expireCheckoutSessions(
  payments: { id: string; stripeCheckoutSessionId: string | null }[],
): Promise<string[]> {
  const completed: string[] = [];
  if (payments.length === 0) return completed;
  const stripe = getStripe();
  for (const p of payments) {
    if (!p.stripeCheckoutSessionId) continue;
    try {
      await stripe.checkout.sessions.expire(p.stripeCheckoutSessionId);
    } catch {
      // Già scaduta o già completata: verifica lo stato reale.
      try {
        const s = await stripe.checkout.sessions.retrieve(p.stripeCheckoutSessionId);
        if (s.status === "complete") completed.push(p.id);
      } catch (e) {
        console.error(`[activation] verifica sessione ${p.stripeCheckoutSessionId} fallita:`, e);
      }
    }
  }
  return completed;
}

export class ActivationConflictError extends Error {}

/**
 * Rende non più pagabili i pagamenti di attivazione in attesa (FALLITO con
 * nota, sessione Stripe chiusa) e azzera firstPaymentLinkSentAt: niente
 * solleciti finché l'admin non reinvia il link. Usata da modifiche alle righe,
 * pagamento manuale e annullamento.
 *
 * Lancia ActivationConflictError se una sessione risulta già pagata.
 */
export async function invalidatePendingActivation(
  subscriptionId: string,
  reason: string,
): Promise<number> {
  const pending = await prisma.payment.findMany({
    where: {
      subscriptionId,
      kind: "ACTIVATION",
      OR: [{ status: "IN_ATTESA" }, { status: "FALLITO", note: null }],
    },
    select: { id: true, stripeCheckoutSessionId: true },
  });
  const completed = await expireCheckoutSessions(pending);
  if (completed.length > 0) {
    throw new ActivationConflictError(
      "Il cliente ha appena completato il pagamento online: attendi la conferma (ricarica tra qualche istante).",
    );
  }
  await prisma.$transaction([
    prisma.payment.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: "FALLITO", note: `${INVALIDATED_NOTE_PREFIX}: ${reason}` },
    }),
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: { firstPaymentLinkSentAt: null },
    }),
  ]);
  return pending.length;
}

/** Se l'abbonamento è in attesa, invalida il link dopo una modifica alle righe. */
export async function invalidateIfPending(subscriptionId: string, reason: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { activationState: true },
  });
  if (sub?.activationState === "PENDING_FIRST_PAYMENT") {
    await invalidatePendingActivation(subscriptionId, reason);
  }
}

export type FirstPaymentLinkResult = {
  paymentId: string | null;
  payUrl: string | null;
  emailSent: boolean;
  /** Email inviata: benvenuto (primo abbonamento) o "Attivazione nuovi servizi". */
  emailKind: "WELCOME" | "FIRST_PAYMENT_LINK" | null;
  error?: string;
};

/**
 * Prepara il link del primo pagamento e lo invia al cliente:
 * - riusa il pagamento di attivazione in attesa se ancora valido, altrimenti ne
 *   crea uno nuovo (Stripe Checkout, prezzi iniziali, periodo inizio → fine);
 * - primo abbonamento del cliente → benvenuto con PDF + blocco "Primo
 *   pagamento"; cliente già servito → email "Attivazione nuovi servizi";
 * - a invio riuscito imposta firstPaymentLinkSentAt (base dei solleciti).
 * Mai bloccante per l'abbonamento: gli errori tornano in `error`.
 */
export async function sendFirstPaymentLink(
  subscriptionId: string,
  opts: { trigger: EmailTrigger; autoChargeUrl?: string | null },
): Promise<FirstPaymentLinkResult> {
  const appUrl = process.env.APP_URL;
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      client: { select: WELCOME_CLIENT_SELECT },
      items: { include: { service: true }, orderBy: { endDate: "asc" } },
    },
  });
  if (!sub) return { paymentId: null, payUrl: null, emailSent: false, emailKind: null, error: "Abbonamento non trovato" };
  if (sub.activationState !== "PENDING_FIRST_PAYMENT") {
    return { paymentId: null, payUrl: null, emailSent: false, emailKind: null, error: "L'abbonamento non è in attesa del primo pagamento" };
  }
  if (!appUrl) return { paymentId: null, payUrl: null, emailSent: false, emailKind: null, error: "APP_URL non configurata" };
  const items = activationItems(sub.items);
  if (items.length === 0) {
    return { paymentId: null, payUrl: null, emailSent: false, emailKind: null, error: "Nessun servizio da attivare" };
  }

  // Pagamento: riuso se ancora pagabile (anche scaduto: /pay lo rigenera).
  let payment = await findPayableActivationPayment(sub.id);
  if (!payment) {
    try {
      const created = await createCheckoutPayment(
        {
          subscriptionId: sub.id,
          clientEmail: sub.client.email || null,
          serviceFeeEnabled: sub.serviceFeeEnabled,
          kind: "ACTIVATION",
          items: items.map(toActivationCheckoutItem),
        },
        appUrl,
        { sendToClient: false, trigger: opts.trigger },
      );
      payment = await prisma.payment.findUniqueOrThrow({
        where: { id: created.payment.id },
        include: { items: true },
      });
    } catch (e) {
      console.error(`[activation] creazione link primo pagamento fallita (sub ${sub.id}):`, e);
      return {
        paymentId: null,
        payUrl: null,
        emailSent: false,
        emailKind: null,
        error: `Link di pagamento non creato: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  const payUrl = `${appUrl}/pay/${payment.payToken}`;
  const block: FirstPaymentBlock = {
    payUrl,
    netCents: items.reduce((s, it) => s + activationNetCents(it), 0),
    currency: items[0].currency,
  };

  if (!sub.client.email) {
    return { paymentId: payment.id, payUrl, emailSent: false, emailKind: null, error: "Cliente senza email: link creato ma non inviato" };
  }

  let emailSent = false;
  let emailKind: FirstPaymentLinkResult["emailKind"];
  if (!sub.client.welcomeEmailSentAt) {
    emailKind = "WELCOME";
    emailSent = await sendWelcomeEmail({
      client: sub.client,
      subscriptionId: sub.id,
      items,
      autoChargeUrl: opts.autoChargeUrl ?? null,
      firstPayment: block,
      trigger: opts.trigger,
    });
  } else {
    emailKind = "FIRST_PAYMENT_LINK";
    const clientName = sub.client.ragioneSociale?.trim() ? sub.client.ragioneSociale : sub.client.name;
    const lang = langOf(sub.client.locale);
    const res = await sendEmail(
      buildFirstPaymentEmail({
        clientName,
        items: firstPaymentEmailItems(items, lang),
        currency: block.currency,
        payment: block,
        lang,
      }),
      sub.client.email,
      {
        type: "FIRST_PAYMENT_LINK",
        trigger: opts.trigger,
        clientId: sub.client.id,
        subscriptionId: sub.id,
        itemIds: items.map((it) => it.id),
      },
    );
    emailSent = res.status === "INVIATA";
  }

  if (emailSent) {
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: sub.id },
        data: { firstPaymentLinkSentAt: new Date() },
      }),
      prisma.payment.update({ where: { id: payment.id }, data: { linkSentAt: new Date() } }),
    ]);
  }
  return {
    paymentId: payment.id,
    payUrl,
    emailSent,
    emailKind,
    ...(emailSent ? {} : { error: "Invio email non riuscito: vedi Log email" }),
  };
}

/**
 * Registra il primo pagamento come MANUALE (già incassato) e attiva
 * l'abbonamento con la stessa logica di conferma del pagamento online:
 * importo = prezzi iniziali, date invariate, ricevuta ed email di conferma.
 * Invalida prima l'eventuale link Stripe in attesa (mai due incassi).
 */
export async function recordManualActivation(
  subscriptionId: string,
  data: { paidAt?: Date; note?: string; recordedById: string },
): Promise<ConfirmPaymentResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { items: true },
  });
  if (!sub) throw new ActivationConflictError("Abbonamento non trovato");
  if (sub.activationState !== "PENDING_FIRST_PAYMENT") {
    throw new ActivationConflictError("L'abbonamento non è in attesa del primo pagamento");
  }
  const items = activationItems(sub.items);
  if (items.length === 0) throw new ActivationConflictError("Nessun servizio da attivare");
  if (new Set(items.map((it) => it.currency)).size > 1) {
    throw new ActivationConflictError("I servizi hanno valute diverse: non è possibile un unico pagamento.");
  }

  await invalidatePendingActivation(sub.id, "sostituito da pagamento manuale");

  // Nessun costo di servizio sui pagamenti manuali (solo Stripe), come oggi.
  const itemGross = items.map((it) => addVatToNet(activationNetCents(it)).grossCents);
  const created = await prisma.payment.create({
    data: {
      subscriptionId: sub.id,
      kind: "ACTIVATION",
      amountCents: itemGross.reduce((s, c) => s + c, 0),
      currency: items[0].currency,
      method: "MANUALE",
      status: "CONFERMATO",
      paidAt: data.paidAt ?? new Date(),
      note: data.note,
      recordedById: data.recordedById,
      items: {
        create: items.map((it, idx) => ({
          subscriptionItemId: it.id,
          amountCents: itemGross[idx],
          status: "IN_ATTESA" as const,
          periodStart: it.startDate,
          periodEnd: it.endDate,
        })),
      },
    },
  });
  return confirmPaymentAndRenew(created.id, "MANUAL");
}

/** Nota del pagamento manuale: metodo scelto (es. Bonifico) + note libere. */
export function manualPaymentNote(method: string | undefined, note: string | undefined): string | undefined {
  const parts = [method?.trim(), note?.trim()].filter(Boolean);
  return parts.length ? parts.join(" — ") : undefined;
}

/**
 * Da chiamare PRIMA di modificare righe o importi di un abbonamento: se è in
 * attesa del primo pagamento invalida il link (l'admin dovrà reinviarlo col
 * nuovo importo). Ritorna un messaggio d'errore se il cliente ha appena pagato.
 */
export async function invalidateBeforeChange(
  subscriptionId: string,
  reason: string,
): Promise<string | null> {
  try {
    await invalidateIfPending(subscriptionId, reason);
    return null;
  } catch (e) {
    if (e instanceof ActivationConflictError) return e.message;
    throw e;
  }
}
