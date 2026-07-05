import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { computeItemStatus } from "@/lib/subscription-status";
import { sendEmail } from "@/lib/send-email";
import { buildRefundConfirmationEmail } from "@/lib/email-templates";

type Params = { params: { id: string } };

// POST /api/payments/[id]/refund
// Body opzionale: { paymentItemIds?: string[] }
//  - assente/vuoto → storno TOTALE (tutte le righe non ancora stornate).
//  - presente      → storno PARZIALE (solo le righe indicate).
//
// Storna su Stripe l'importo delle righe selezionate (parziale se non è tutto il
// pagamento). Per ogni riga stornata: PaymentItem.status = RIMBORSATO e, se la
// riga aveva rinnovato la sua SubscriptionItem, il rinnovo viene disfatto dagli
// snapshot (endDate/priceCents/lastRenewalAt) con ricalcolo dello status.
// Payment.status diventa RIMBORSATO solo se TUTTE le righe risultano stornate.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: {
        items: {
          include: { subscriptionItem: { include: { service: true } } },
        },
        subscription: { include: { client: true } },
      },
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

    // Righe stornabili: confermate e non già rimborsate.
    const refundable = payment.items.filter((pi) => pi.status === "CONFERMATO");
    if (refundable.length === 0) {
      return error("Nessuna riga da stornare per questo pagamento", 409);
    }

    // Selezione: righe indicate (partial) o tutte le stornabili (totale).
    const body = await req.json().catch(() => ({}));
    const requestedIds: string[] | null = Array.isArray(body?.paymentItemIds)
      ? body.paymentItemIds.filter((v: unknown) => typeof v === "string")
      : null;

    let selected = refundable;
    if (requestedIds && requestedIds.length > 0) {
      const set = new Set(requestedIds);
      selected = refundable.filter((pi) => set.has(pi.id));
      if (selected.length !== requestedIds.length) {
        return error(
          "Una o più righe indicate non appartengono al pagamento o non sono stornabili",
          400,
        );
      }
    }

    // Guard "ultimo rinnovo" PER RIGA: non si può disfare il rinnovo di una riga
    // se esiste un pagamento CONFERMATO successivo che la copre.
    for (const pi of selected) {
      if (pi.previousEndDate == null) continue; // niente rinnovo da disfare
      const laterItem = await prisma.paymentItem.findFirst({
        where: {
          subscriptionItemId: pi.subscriptionItemId,
          status: "CONFERMATO",
          payment: {
            status: "CONFERMATO",
            createdAt: { gt: payment.createdAt },
          },
        },
        select: { id: true },
      });
      if (laterItem) {
        return error(
          "Non è possibile stornare automaticamente: una delle righe ha rinnovi successivi. Contatta l'assistenza tecnica per un aggiustamento manuale.",
          409,
        );
      }
    }

    const refundAmount = selected.reduce((sum, pi) => sum + pi.amountCents, 0);
    const isTotal = selected.length === refundable.length;

    // Storno su Stripe: importo pari alla somma delle righe selezionate.
    const stripe = getStripe();
    try {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        // Su storno totale ometteremmo amount, ma qui rimborsiamo comunque solo
        // le righe ancora CONFERMATE: passiamo sempre l'importo esatto.
        amount: refundAmount,
      });
      if (refund.status === "failed") {
        return error("Lo storno su Stripe è stato rifiutato.", 400);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "errore sconosciuto";
      return error(`Storno non riuscito su Stripe: ${msg}`, 400);
    }

    // Aggiornamento coerente in un'unica transazione.
    const result = await prisma.$transaction(async (tx) => {
      let itemsReverted = 0;
      const refundedDetails: {
        serviceName: string;
        amountCents: number;
        renewalReverted: boolean;
      }[] = [];

      for (const pi of selected) {
        await tx.paymentItem.update({
          where: { id: pi.id },
          data: { status: "RIMBORSATO" },
        });

        const renewalReverted = pi.previousEndDate != null;
        refundedDetails.push({
          serviceName: pi.subscriptionItem.service.name,
          amountCents: pi.amountCents,
          renewalReverted,
        });

        // Disfa il rinnovo della riga solo se questo pagamento l'aveva rinnovata.
        if (pi.previousEndDate != null) {
          const item = pi.subscriptionItem;
          const restoredEndDate = pi.previousEndDate;
          const restoredPriceCents = pi.previousPriceCents ?? item.priceCents;
          const restoredLastRenewalAt = pi.previousLastRenewalAt;

          const recomputed = computeItemStatus({
            status: item.status,
            endDate: restoredEndDate,
            billingPeriod: item.billingPeriod,
            customPeriodDays: item.customPeriodDays,
            lastRenewalAt: restoredLastRenewalAt,
          });

          // Il rinnovo di QUESTA riga è stato annullato: non deve più risultare
          // RINNOVATO. Torna ai valori precedenti come ATTIVO (mantenendo però
          // SCADUTO/IN_SCADENZA se la data ripristinata lo giustifica realmente).
          const newStatus = recomputed === "RINNOVATO" ? "ATTIVO" : recomputed;

          await tx.subscriptionItem.update({
            where: { id: item.id },
            data: {
              endDate: restoredEndDate,
              priceCents: restoredPriceCents,
              lastRenewalAt: restoredLastRenewalAt,
              status: newStatus,
            },
          });
          itemsReverted++;
        }
      }

      // Payment.status passa a RIMBORSATO solo se tutte le righe sono stornate.
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: isTotal ? { status: "RIMBORSATO" } : {},
      });

      return {
        payment: updatedPayment,
        refundedItemIds: selected.map((pi) => pi.id),
        refundedDetails,
        itemsReverted,
        partial: !isTotal,
        refundAmountCents: refundAmount,
      };
    });

    // ── Email di conferma storno al cliente (FUORI transazione, non bloccante) ──
    const client = payment.subscription.client;
    if (client.email) {
      try {
        const clientName = client.ragioneSociale?.trim()
          ? client.ragioneSociale
          : client.name;
        const content = buildRefundConfirmationEmail({
          clientName,
          items: result.refundedDetails,
          totalCents: result.refundAmountCents,
          currency: payment.currency,
          isTotal,
        });
        await sendEmail(content, client.email);
      } catch (e) {
        console.error(
          `[refund] invio conferma storno fallito (payment ${payment.id}):`,
          e,
        );
      }
    }

    return json(result);
  });
}
