import "server-only";
import type { Payment, Receipt, SubscriptionItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReceiptForPayment } from "@/lib/create-receipt";
import { buildConfirmationEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";

/** Esito del rinnovo di una singola riga (SubscriptionItem) del pagamento. */
export type ConfirmPaymentItemResult = {
  subscriptionItem: SubscriptionItem;
  serviceName: string;
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
 * Controllo difensivo per singola riga: se billingPeriod è PERSONALIZZATA ma
 * customPeriodDays è null, quella riga viene registrata come pagata ma NON
 * rinnovata (renewalSkipped: true) — senza bloccare le altre righe né annullare
 * il pagamento.
 */
export async function confirmPaymentAndRenew(
  paymentId: string,
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

    // ── Rinnovo INDIPENDENTE di ciascuna riga ───────────────────────────────
    const items: ConfirmPaymentItemResult[] = [];
    for (const pi of payment.items) {
      const { service, ...itemOnly } = pi.subscriptionItem;

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

      // Incremento composto sul priceCents CORRENTE della riga.
      const newPriceCents = renewalSkipped
        ? itemOnly.priceCents
        : Math.round(
            itemOnly.priceCents * (1 + service.renewalIncreasePercent / 100),
          );

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
          },
        });
      }

      items.push({
        subscriptionItem: updatedItem,
        serviceName: service.name,
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

    // ── Ricevuta (dentro la stessa transazione) ─────────────────────────────
    const receipt = await createReceiptForPayment(payment.id, tx);

    return {
      payment: updatedPayment,
      receipt,
      items,
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
): Promise<void> {
  const receipt = result.receipt;
  const subscriptionId = result.payment.subscriptionId;

  const commonData = {
    subscriptionId,
    clientName: receipt.clientName,
    items: result.items.map((i) => ({
      serviceName: i.serviceName,
      amountCents: i.amountCents,
      newEndDate: i.newEndDate,
    })),
    totalCents: receipt.amountCents,
    currency: receipt.currency,
    method: result.payment.method,
    receiptToken: receipt.token,
  };

  // Invio all'admin (destinatario di default = ADMIN_EMAIL).
  await deliverConfirmation({
    paymentId,
    dedupeKey: `${paymentId}-admin`,
    recipient: process.env.ADMIN_EMAIL,
    content: buildConfirmationEmail({ ...commonData, audience: "admin" }),
  });

  // Invio al cliente (email dallo snapshot ricevuta): mai link dashboard admin.
  if (receipt.clientEmail) {
    await deliverConfirmation({
      paymentId,
      dedupeKey: `${paymentId}-client`,
      recipient: receipt.clientEmail,
      content: buildConfirmationEmail({ ...commonData, audience: "client" }),
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
