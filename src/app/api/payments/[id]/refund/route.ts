import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { computeSubscriptionStatus } from "@/lib/subscription-status";

type Params = { params: { id: string } };

// POST /api/payments/[id]/refund
// Storna totalmente un pagamento Stripe confermato. Se il pagamento aveva
// rinnovato l'abbonamento ED è l'ultimo pagamento confermato, disfa il rinnovo
// ripristinando endDate/priceCents/lastRenewalAt e ricalcolando lo status.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: { subscription: true },
    });
    if (!payment) return error("Pagamento non trovato", 404);

    if (payment.method !== "STRIPE" || payment.status !== "CONFERMATO") {
      return error(
        "Solo pagamenti Stripe confermati possono essere stornati",
        400,
      );
    }
    if (!payment.stripePaymentIntentId) {
      return error(
        "Nessun riferimento Stripe disponibile per questo pagamento",
        400,
      );
    }

    // Controllo ultimo pagamento: nessun altro CONFERMATO successivo.
    const laterPayment = await prisma.payment.findFirst({
      where: {
        subscriptionId: payment.subscriptionId,
        status: "CONFERMATO",
        createdAt: { gt: payment.createdAt },
      },
      select: { id: true },
    });
    if (laterPayment) {
      return error(
        "Non è possibile stornare automaticamente: sono stati registrati pagamenti successivi a questo. Contatta l'assistenza tecnica per un aggiustamento manuale.",
        409,
      );
    }

    // Storno totale su Stripe (nessun amount = intero importo).
    const stripe = getStripe();
    try {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
      });
      if (refund.status === "failed") {
        return error("Lo storno su Stripe è stato rifiutato.", 400);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "errore sconosciuto";
      return error(`Storno non riuscito su Stripe: ${msg}`, 400);
    }

    // Aggiornamento coerente in un'unica transazione.
    const sub = payment.subscription;
    const result = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: "RIMBORSATO" },
      });

      // Nessun rinnovo da disfare (es. pagamenti storici pre-feature).
      if (payment.previousEndDate == null) {
        return {
          payment: updatedPayment,
          subscription: sub,
          renewalReverted: false,
        };
      }

      // Ripristino i 3 valori insieme + ricalcolo status (mai uno senza gli altri).
      const restoredEndDate = payment.previousEndDate;
      const restoredPriceCents = payment.previousPriceCents ?? sub.priceCents;
      const restoredLastRenewalAt = payment.previousLastRenewalAt;

      const newStatus = computeSubscriptionStatus({
        status: sub.status,
        endDate: restoredEndDate,
        billingPeriod: sub.billingPeriod,
        customPeriodDays: sub.customPeriodDays,
        lastRenewalAt: restoredLastRenewalAt,
      });

      const updatedSubscription = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          endDate: restoredEndDate,
          priceCents: restoredPriceCents,
          lastRenewalAt: restoredLastRenewalAt,
          status: newStatus,
        },
      });

      return {
        payment: updatedPayment,
        subscription: updatedSubscription,
        renewalReverted: true,
      };
    });

    return json(result);
  });
}
