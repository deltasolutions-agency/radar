import "server-only";
import type {
  EmailTrigger,
  Payment,
  Receipt,
  SubscriptionItem,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReceiptForPayment } from "@/lib/create-receipt";
import { buildConfirmationEmail } from "@/lib/email-templates";
import { sendEmail, type EmailLogMeta } from "@/lib/send-email";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { renewalOutcome } from "@/lib/renewal-price";
import { formatDate } from "@/lib/format";
import { romeYmd } from "@/lib/rome-time";
import { computeItemStatus } from "@/lib/subscription-status";

/** Esito del rinnovo di una singola riga (SubscriptionItem) del pagamento. */
export type ConfirmPaymentItemResult = {
  subscriptionItem: SubscriptionItem;
  serviceName: string;
  endClientName: string | null;
  amountCents: number;
  /** Nuova scadenza della riga dopo il rinnovo (o quella corrente se saltato). */
  newEndDate: Date;
  /** true se il rinnovo di questa riga è stato saltato (vedi renewalReason). */
  renewalSkipped: boolean;
  renewalReason?: string;
};

export type ConfirmPaymentResult = {
  payment: Payment;
  receipt: Receipt;
  /** Un elemento per ciascun PaymentItem confermato in questo pagamento. */
  items: ConfirmPaymentItemResult[];
  /** true se il pagamento era già stato confermato ed elaborato (retry). */
  alreadyProcessed: boolean;
  /**
   * Solo per il primo pagamento (Payment.kind = ACTIVATION): l'abbonamento è
   * stato attivato con le date del form; startDatePassed = la data di inizio
   * più vicina era già passata alla conferma (avviso all'admin).
   */
  activation?: { startDatePassed: boolean; earliestStartDate: Date };
};

/**
 * Punto UNICO in cui un pagamento passa a CONFERMATO e le righe di servizio
 * coperte vengono rinnovate. La usano sia il webhook Stripe sia il pagamento
 * manuale.
 *
 * Tutto avviene in una singola transazione (conferma + rinnovo di OGNI riga +
 * ricevuta): garantisce che non esista mai lo stato "CONFERMATO senza ricevuta
 * ma già rinnovato", che permetterebbe a un retry di raddoppiare il rinnovo.
 *
 * Idempotente: se il Payment è già CONFERMATO E ha già una ricevuta, ritorna
 * gli oggetti esistenti SENZA rinnovare di nuovo (retry del webhook Stripe).
 * Il controllo avviene PRIMA di toccare le righe.
 *
 * NOTA CRITICA: il calcolo del rinnovo è INDIPENDENTE per ogni riga — item con
 * periodi diversi nello stesso pagamento avanzano ciascuno della propria durata,
 * non una durata comune.
 *
 * Primo pagamento (Payment.kind = ACTIVATION): è un'ATTIVAZIONE, non un
 * rinnovo. Le righe vengono confermate SENZA spostare le date né applicare
 * l'aumento (nessuno snapshot pre-rinnovo: lo storno non tocca le date) e
 * l'abbonamento passa ad ACTIVE nella stessa transazione. Webhook Stripe,
 * pagamento manuale e storno passano tutti da qui.
 *
 * Controllo difensivo per singola riga: se billingPeriod è PERSONALIZZATA ma
 * customPeriodDays è null, quella riga viene registrata come pagata ma NON
 * rinnovata (renewalSkipped: true) — senza bloccare le altre righe né annullare
 * il pagamento.
 */
export async function confirmPaymentAndRenew(
  paymentId: string,
  /** Chi ha innescato la conferma (per EmailLog): WEBHOOK, MANUAL o CRON. */
  trigger: EmailTrigger,
): Promise<ConfirmPaymentResult> {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        receipt: true,
        items: {
          include: { subscriptionItem: { include: { service: true } } },
        },
      },
    });

    if (!payment) {
      throw new Error(`Payment ${paymentId} non trovato`);
    }

    // ── Idempotenza (PRIMA di toccare le righe) ─────────────────────────────
    // Già confermato e con ricevuta → retry: ritorna l'esistente senza rinnovo.
    if (payment.status === "CONFERMATO" && payment.receipt) {
      const items: ConfirmPaymentItemResult[] = payment.items.map((pi) => {
        const { service, ...itemOnly } = pi.subscriptionItem;
        return {
          subscriptionItem: itemOnly,
          serviceName: service.name,
          endClientName: itemOnly.endClientName,
          amountCents: pi.amountCents,
          newEndDate: itemOnly.endDate,
          renewalSkipped: false,
        };
      });
      return {
        payment,
        receipt: payment.receipt,
        items,
        alreadyProcessed: true,
      };
    }

    const paidAt = payment.paidAt ?? new Date();
    const now = new Date();
    const isActivation = payment.kind === "ACTIVATION";

    // ── Rinnovo INDIPENDENTE di ciascuna riga ───────────────────────────────
    const items: ConfirmPaymentItemResult[] = [];
    for (const pi of payment.items) {
      const { service, ...itemOnly } = pi.subscriptionItem;

      // Attivazione: conferma senza rinnovo (date e prezzo invariati).
      if (isActivation) {
        await tx.paymentItem.update({
          where: { id: pi.id },
          data: { status: "CONFERMATO" },
        });
        const activatedItem = await tx.subscriptionItem.update({
          where: { id: itemOnly.id },
          data: { status: computeItemStatus(itemOnly) },
        });
        items.push({
          subscriptionItem: activatedItem,
          serviceName: service.name,
          endClientName: itemOnly.endClientName,
          amountCents: pi.amountCents,
          newEndDate: itemOnly.endDate,
          renewalSkipped: false,
        });
        continue;
      }

      const durationDays = periodDurationDays(itemOnly);
      const renewalSkipped =
        itemOnly.billingPeriod === "PERSONALIZZATA" && durationDays == null;
      const renewalReason = renewalSkipped
        ? "Periodicità PERSONALIZZATA senza customPeriodDays: rinnovo della data saltato."
        : undefined;

      // Nuovo endDate ANCORATO al vecchio endDate (mai alla data di pagamento).
      const newEndDate =
        !renewalSkipped && durationDays != null
          ? new Date(itemOnly.endDate.getTime() + durationDays * MS_PER_DAY)
          : itemOnly.endDate;

      // Nuovo prezzo dalla funzione condivisa (src/lib/renewal-price.ts):
      // il prezzo pagato al rinnovo (aumento incluso se dovuto) diventa il
      // corrente; ONCE segna anche l'indicatore e da lì il prezzo è bloccato.
      const outcome = renewalOutcome({ ...itemOnly, service }, now);
      const newPriceCents = renewalSkipped
        ? itemOnly.priceCents
        : outcome.newPriceCents;
      const onceApplied = !renewalSkipped && outcome.onceIncreaseApplied;

      // Conferma della riga di pagamento + snapshot pre-rinnovo (per lo storno).
      // periodStart/periodEnd sono già stati impostati alla creazione del
      // pagamento (checkout / manuale) e non vengono toccati qui.
      await tx.paymentItem.update({
        where: { id: pi.id },
        data: {
          status: "CONFERMATO",
          ...(renewalSkipped
            ? {}
            : {
                previousEndDate: itemOnly.endDate,
                previousPriceCents: itemOnly.priceCents,
                previousLastRenewalAt: itemOnly.lastRenewalAt,
                previousRenewalIncreaseAppliedAt: itemOnly.renewalIncreaseAppliedAt,
                onceIncreaseApplied: onceApplied,
              }),
        },
      });

      // Rinnovo della riga di servizio (solo se non saltato).
      let updatedItem: SubscriptionItem = itemOnly;
      if (!renewalSkipped) {
        updatedItem = await tx.subscriptionItem.update({
          where: { id: itemOnly.id },
          data: {
            endDate: newEndDate,
            priceCents: newPriceCents,
            lastRenewalAt: now,
            status: "RINNOVATO",
            ...(onceApplied ? { renewalIncreaseAppliedAt: now } : {}),
          },
        });
      }

      items.push({
        subscriptionItem: updatedItem,
        serviceName: service.name,
        endClientName: itemOnly.endClientName,
        amountCents: pi.amountCents,
        newEndDate,
        renewalSkipped,
        renewalReason,
      });
    }

    // ── Conferma del Payment (stato aggregato) ──────────────────────────────
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "CONFERMATO", paidAt },
    });

    // ── Attivazione dell'abbonamento (primo pagamento) ──────────────────────
    let activation: ConfirmPaymentResult["activation"];
    if (isActivation) {
      await tx.subscription.update({
        where: { id: payment.subscriptionId },
        data: { activationState: "ACTIVE" },
      });
      const earliestStartDate = new Date(
        Math.min(...payment.items.map((pi) => pi.subscriptionItem.startDate.getTime())),
      );
      // Confronto a giorni: le date delle righe sono giorni (mezzanotte UTC),
      // il pagamento è un istante → giorno in ora italiana.
      activation = {
        earliestStartDate,
        startDatePassed: earliestStartDate.toISOString().slice(0, 10) < romeYmd(paidAt),
      };
    }

    // ── Ricevuta (dentro la stessa transazione) ─────────────────────────────
    const receipt = await createReceiptForPayment(payment.id, tx);

    return {
      payment: updatedPayment,
      receipt,
      items,
      alreadyProcessed: false,
      activation,
    };
  });

  // ── Email di conferma pagamento (FUORI dalla transazione) ─────────────────
  // Mai bloccante: un fallimento non annulla il pagamento già confermato.
  // Saltata sui retry (alreadyProcessed) e comunque de-duplicata su paymentId.
  if (!result.alreadyProcessed) {
    await sendConfirmationEmail(paymentId, result, trigger);
  }

  return result;
}

/**
 * Invia l'email CONFERMA_ACQUISTO all'admin E al cliente, con un NotificationLog
 * distinto per ciascun destinatario.
 *
 * Due record (dedupeKey "{paymentId}-admin" e "{paymentId}-client") anziché uno:
 * tracciano separatamente l'esito dei due invii (uno può fallire senza l'altro).
 *
 * Ogni invio è isolato e non-bloccante: un errore verso il cliente non impedisce
 * l'invio all'admin, né viceversa, né la conferma del pagamento.
 *
 * Il pagamento può coprire PIÙ servizi: l'email elenca ogni riga (servizio,
 * importo, nuova scadenza) con il totale, consumando `result.items`.
 */
async function sendConfirmationEmail(
  paymentId: string,
  result: ConfirmPaymentResult,
  trigger: EmailTrigger,
): Promise<void> {
  const receipt = result.receipt;
  const subscriptionId = result.payment.subscriptionId;
  const sub = await prisma.subscription
    .findUnique({ where: { id: subscriptionId }, select: { clientId: true } })
    .catch(() => null);
  const logMeta = {
    trigger,
    clientId: sub?.clientId ?? null,
    subscriptionId,
    itemIds: result.items.map((i) => i.subscriptionItem.id),
  };

  const commonData = {
    subscriptionId,
    clientName: receipt.clientName,
    items: result.items.map((i) => ({
      serviceName: i.serviceName,
      endClientName: i.endClientName,
      amountCents: i.amountCents,
      newEndDate: i.newEndDate,
    })),
    totalCents: receipt.amountCents,
    taxableCents: receipt.taxableAmountCents,
    vatCents: receipt.vatAmountCents,
    serviceFeeCents: receipt.serviceFeeCents,
    currency: receipt.currency,
    method: result.payment.method,
    receiptToken: receipt.token,
    activation: !!result.activation,
  };
  const startDateWarning = result.activation?.startDatePassed
    ? `La data di inizio (${formatDate(result.activation.earliestStartDate)}) era già passata al momento del pagamento: le date sono rimaste quelle impostate. Verifica se modificarle.`
    : null;

  // Invio all'admin (destinatario di default = ADMIN_EMAIL).
  await deliverConfirmation({
    paymentId,
    dedupeKey: `${paymentId}-admin`,
    recipient: process.env.ADMIN_EMAIL,
    content: buildConfirmationEmail({ ...commonData, audience: "admin", startDateWarning }),
    logMeta,
  });

  // Invio al cliente (email dallo snapshot ricevuta): mai link dashboard admin.
  if (receipt.clientEmail) {
    await deliverConfirmation({
      paymentId,
      dedupeKey: `${paymentId}-client`,
      recipient: receipt.clientEmail,
      content: buildConfirmationEmail({ ...commonData, audience: "client" }),
      logMeta,
    });
  }
}

/**
 * Invia una singola email di conferma e registra il relativo NotificationLog.
 * Idempotente sul dedupeKey; non lancia mai (errori loggati e ignorati).
 *
 * L'email è a livello di PAGAMENTO (non di singola riga): il NotificationLog non
 * è legato a un subscriptionItemId specifico — la de-duplicazione avviene su
 * (type, dedupeKey), con dedupeKey univoco per paymentId+destinatario.
 */
async function deliverConfirmation(params: {
  paymentId: string;
  dedupeKey: string;
  recipient?: string;
  content: { subject: string; text: string; html: string };
  logMeta: Omit<EmailLogMeta, "type" | "dedupeKey">;
}): Promise<void> {
  try {
    const existing = await prisma.notificationLog.findFirst({
      where: { type: "CONFERMA_ACQUISTO", dedupeKey: params.dedupeKey },
      select: { id: true },
    });
    if (existing) return;

    const sent = await sendEmail(params.content, params.recipient, {
      ...params.logMeta,
      type: "PAYMENT_RECEIPT",
      dedupeKey: `payment-receipt:${params.dedupeKey}`,
    });

    await prisma.notificationLog.create({
      data: {
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
