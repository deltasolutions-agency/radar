import "server-only";
import type { Payment, Receipt, Subscription, Service } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReceiptForPayment } from "@/lib/create-receipt";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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

/** Durata del periodo in giorni dal billingPeriod snapshot della subscription. */
function periodDurationDays(sub: {
  billingPeriod: Subscription["billingPeriod"];
  customPeriodDays: number | null;
}): number | null {
  switch (sub.billingPeriod) {
    case "MENSILE":
      return 30;
    case "ANNUALE":
      return 365;
    case "PERSONALIZZATA":
      return sub.customPeriodDays ?? null;
    default:
      return null;
  }
}

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
  return prisma.$transaction(async (tx) => {
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

    // ── Conferma Payment + periodo coperto ──────────────────────────────────
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CONFERMATO",
        paidAt,
        // Il pagamento copre vecchio endDate → nuovo endDate (solo se rinnovato).
        ...(renewalSkipped
          ? {}
          : { periodStart: sub.endDate, periodEnd: newEndDate }),
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
}
