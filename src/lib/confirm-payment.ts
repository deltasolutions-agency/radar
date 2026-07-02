import "server-only";
import type { Payment, Receipt, Subscription, Service } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReceiptForPayment } from "@/lib/create-receipt";
import { buildConfirmationEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";

export type ConfirmPaymentResult = {
  payment: Payment;
  receipt: Receipt;
  subscription: Subscription;
  /** true se il rinnovo della data/prezzo è stato saltato (vedi renewalReason). */
  renewalSkipped: boolean;
  renewalReason?: string;
  /** true se il pagamento era già stato confermato ed elaborato (retry). */
  alreadyProcessed: boolean;
};

/**
 * Punto UNICO in cui un pagamento passa a CONFERMATO e la subscription viene
 * rinnovata. La usano sia il webhook Stripe sia il pagamento manuale.
 *
 * Tutto avviene in una singola transazione (conferma + rinnovo + ricevuta):
 * questo garantisce che non esista mai lo stato "CONFERMATO senza ricevuta ma
 * già rinnovato", che permetterebbe a un retry di raddoppiare il rinnovo.
 *
 * Idempotente: se il Payment è già CONFERMATO E ha già una ricevuta, ritorna
 * gli oggetti esistenti SENZA rinnovare di nuovo (retry del webhook Stripe).
 * Il controllo avviene PRIMA di toccare la subscription.
 *
 * Controllo difensivo: se billingPeriod è PERSONALIZZATA ma customPeriodDays è
 * null, il pagamento e la ricevuta vengono comunque registrati ma la data NON
 * viene rinnovata (renewalSkipped: true) — nessuna eccezione, così il pagamento
 * non viene annullato dal rollback.
 */
export async function confirmPaymentAndRenew(
  paymentId: string,
): Promise<ConfirmPaymentResult> {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        receipt: true,
        subscription: { include: { service: true } },
      },
    });

    if (!payment) {
      throw new Error(`Payment ${paymentId} non trovato`);
    }

    // ── Idempotenza (PRIMA di toccare la subscription) ──────────────────────
    // Già confermato e con ricevuta → retry: ritorna l'esistente senza rinnovo.
    if (payment.status === "CONFERMATO" && payment.receipt) {
      const { subscription } = payment;
      const { service: _service, ...subscriptionOnly } = subscription;
      return {
        payment,
        receipt: payment.receipt,
        subscription: subscriptionOnly,
        renewalSkipped: false,
        alreadyProcessed: true,
      };
    }

    const sub = payment.subscription;
    const service: Service = sub.service;
    const paidAt = payment.paidAt ?? new Date();

    // ── Calcolo rinnovo ─────────────────────────────────────────────────────
    const durationDays = periodDurationDays(sub);
    const renewalSkipped =
      sub.billingPeriod === "PERSONALIZZATA" && durationDays == null;
    const renewalReason = renewalSkipped
      ? "Periodicità PERSONALIZZATA senza customPeriodDays: rinnovo della data saltato."
      : undefined;

    // Nuovo endDate ANCORATO al vecchio endDate (mai alla data di pagamento).
    const newEndDate =
      !renewalSkipped && durationDays != null
        ? new Date(sub.endDate.getTime() + durationDays * MS_PER_DAY)
        : sub.endDate;

    // Incremento composto sul priceCents CORRENTE della subscription.
    const newPriceCents = renewalSkipped
      ? sub.priceCents
      : Math.round(sub.priceCents * (1 + service.renewalIncreasePercent / 100));

    // ── Conferma Payment + periodo coperto + snapshot pre-rinnovo ────────────
    // sub.* contiene ancora i valori ATTUALI (la subscription non è ancora stata
    // aggiornata): li salviamo sul Payment per poter disfare il rinnovo in caso
    // di storno. Solo se c'è stato un rinnovo (non renewalSkipped).
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CONFERMATO",
        paidAt,
        // Il pagamento copre vecchio endDate → nuovo endDate (solo se rinnovato).
        ...(renewalSkipped
          ? {}
          : {
              periodStart: sub.endDate,
              periodEnd: newEndDate,
              previousEndDate: sub.endDate,
              previousPriceCents: sub.priceCents,
              previousLastRenewalAt: sub.lastRenewalAt,
            }),
      },
    });

    // ── Rinnovo Subscription (solo se non saltato) ──────────────────────────
    let updatedSubscription: Subscription;
    if (renewalSkipped) {
      const { service: _s, ...subscriptionOnly } = sub;
      updatedSubscription = subscriptionOnly;
    } else {
      updatedSubscription = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          endDate: newEndDate,
          priceCents: newPriceCents,
          lastRenewalAt: new Date(),
          status: "RINNOVATO",
        },
      });
    }

    // ── Ricevuta (dentro la stessa transazione) ─────────────────────────────
    const receipt = await createReceiptForPayment(payment.id, tx);

    return {
      payment: updatedPayment,
      receipt,
      subscription: updatedSubscription,
      renewalSkipped,
      renewalReason,
      alreadyProcessed: false,
    };
  });

  // ── Email di conferma pagamento (FUORI dalla transazione) ─────────────────
  // Mai bloccante: un fallimento non annulla il pagamento già confermato.
  // Saltata sui retry (alreadyProcessed) e comunque de-duplicata su paymentId.
  if (!result.alreadyProcessed) {
    await sendConfirmationEmail(paymentId, result);
  }

  return result;
}

/**
 * Invia l'email CONFERMA_ACQUISTO all'admin E al cliente, con un NotificationLog
 * distinto per ciascun destinatario.
 *
 * Due record (dedupeKey "{paymentId}-admin" e "{paymentId}-client") anziché uno:
 * rispettano il vincolo @@unique([subscriptionId, type, dedupeKey]) e tracciano
 * separatamente l'esito dei due invii (uno può fallire senza l'altro).
 *
 * Ogni invio è isolato e non-bloccante: un errore verso il cliente non impedisce
 * l'invio all'admin, né viceversa, né la conferma del pagamento.
 */
async function sendConfirmationEmail(
  paymentId: string,
  result: ConfirmPaymentResult,
): Promise<void> {
  const receipt = result.receipt;
  const commonData = {
    subscriptionId: result.subscription.id,
    clientName: receipt.clientName,
    serviceName: receipt.serviceName,
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    endDate: result.subscription.endDate,
    method: result.payment.method,
    receiptToken: receipt.token,
  };

  // Invio all'admin (destinatario di default = ADMIN_EMAIL).
  await deliverConfirmation({
    paymentId,
    subscriptionId: result.subscription.id,
    dedupeKey: `${paymentId}-admin`,
    recipient: process.env.ADMIN_EMAIL,
    content: buildConfirmationEmail({ ...commonData, audience: "admin" }),
  });

  // Invio al cliente (email dallo snapshot ricevuta): mai link dashboard admin.
  if (receipt.clientEmail) {
    await deliverConfirmation({
      paymentId,
      subscriptionId: result.subscription.id,
      dedupeKey: `${paymentId}-client`,
      recipient: receipt.clientEmail,
      content: buildConfirmationEmail({ ...commonData, audience: "client" }),
    });
  }
}

/**
 * Invia una singola email di conferma e registra il relativo NotificationLog.
 * Idempotente sul dedupeKey; non lancia mai (errori loggati e ignorati).
 */
async function deliverConfirmation(params: {
  paymentId: string;
  subscriptionId: string;
  dedupeKey: string;
  recipient?: string;
  content: { subject: string; text: string; html: string };
}): Promise<void> {
  try {
    const existing = await prisma.notificationLog.findFirst({
      where: { type: "CONFERMA_ACQUISTO", dedupeKey: params.dedupeKey },
      select: { id: true },
    });
    if (existing) return;

    const sent = await sendEmail(params.content, params.recipient);

    await prisma.notificationLog.create({
      data: {
        subscriptionId: params.subscriptionId,
        paymentId: params.paymentId,
        type: "CONFERMA_ACQUISTO",
        status: sent.status,
        recipient: params.recipient ?? "(non configurato)",
        resendId: sent.resendId,
        error: sent.error,
        dedupeKey: params.dedupeKey,
      },
    });
  } catch (e) {
    console.error(
      `[confirm-payment] invio conferma (${params.dedupeKey}) fallito:`,
      e,
    );
  }
}
