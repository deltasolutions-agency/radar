import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";
import { createCheckoutPayment } from "@/lib/payment-checkout";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeFailedAdminEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { addVatToNet } from "@/lib/vat";
import { withEndClient } from "@/lib/end-client";
import {
  classifyAutoChargeCandidate,
  groupAutoChargeItems,
  loadAutoChargeCandidates,
  type EligibleItem,
} from "@/lib/cron/auto-charge-selection";

export const runtime = "nodejs";

/** Descrizione PaymentIntent: "Rinnovo automatico: Servizio – Cliente finale, ...". */
function autoChargeDescription(group: EligibleItem[]): string {
  const names = group.map((it) =>
    withEndClient(
      it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
      it.endClientName,
    ),
  );
  return `Rinnovo automatico: ${names.join(", ")}`.slice(0, 500);
}
export const dynamic = "force-dynamic";

// GET /api/cron/auto-charge — addebito automatico ricorrente (off_session).
//
// Le righe (SubscriptionItem) con autoChargeEnabled che risultano scadute
// vengono RAGGRUPPATE per (abbonamento, valuta, giorno di scadenza) in un unico
// Payment + una sola PaymentIntent Stripe — coerente con checkout/pay-manual —
// così un cliente con più servizi che scadono lo stesso giorno vede un solo
// addebito sulla carta. Il rinnovo resta indipendente per riga (confirm-payment).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const now = new Date();
  const stripe = getStripe();
  const appUrl = process.env.APP_URL;

  let charges = 0; // numero di addebiti Stripe (gruppi) tentati
  let attempted = 0; // righe tentate
  let succeeded = 0; // righe rinnovate
  let failed = 0; // righe fallite
  let disabledAfterRetries = 0; // righe disattivate dopo 2 fallimenti

  // Selezione condivisa con scripts/cron-preview.ts (src/lib/cron/auto-charge-selection.ts).
  const candidates = await loadAutoChargeCandidates();

  // ── 1. Pre-filtro per riga → righe realmente addebitabili ─────────────────
  const eligible: EligibleItem[] = [];
  for (const item of candidates) {
    try {
      const decision = classifyAutoChargeCandidate(item, now);

      // Auto-charge scaduto → torna a gestione manuale, nient'altro in questo run.
      if (decision === "DISABLE_EXPIRED") {
        await prisma.subscriptionItem.update({
          where: { id: item.id },
          data: { autoChargeEnabled: false },
        });
        continue;
      }

      if (decision === "ELIGIBLE") eligible.push(item);
    } catch (e) {
      console.error(`[cron auto-charge] pre-filtro item ${item.id}:`, e);
    }
  }

  // ── 2. Raggruppa per (abbonamento, valuta, giorno di scadenza) ────────────
  const groups = groupAutoChargeItems(eligible);

  // ── 3. Un addebito per gruppo ─────────────────────────────────────────────
  for (const group of groups.values()) {
    const first = group[0];
    const client = first.subscription.client;
    const currency = first.currency;
    // Il prezzo inserito è NETTO: l'importo da addebitare è il LORDO (netto +22%)
    // per ogni riga del gruppo.
    const itemGrossCents = group.map(
      (it) => addVatToNet(it.priceCents * it.quantity).grossCents,
    );
    const servicesCents = itemGrossCents.reduce((sum, c) => sum + c, 0);
    // Costo di servizio 1,5% (solo Stripe) sul LORDO dei servizi.
    const serviceFeeCents = computeServiceFeeCents(
      servicesCents,
      first.subscription.serviceFeeEnabled,
    );
    const totalCents = servicesCents + serviceFeeCents;
    attempted += group.length;
    charges++;

    try {
      // Payment IN_ATTESA con una PaymentItem per riga del gruppo.
      const payment = await prisma.payment.create({
        data: {
          subscriptionId: first.subscriptionId,
          amountCents: totalCents,
          serviceFeeCents,
          currency,
          method: "STRIPE",
          status: "IN_ATTESA",
          items: {
            create: group.map((it, idx) => {
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
            }),
          },
        },
      });

      // Tentativo di addebito off_session per l'importo totale del gruppo.
      let charged = false;
      let chargeError: string | undefined;
      let paymentIntentId: string | null = null;
      try {
        const pi = await stripe.paymentIntents.create({
          amount: totalCents,
          currency,
          customer: client.stripeCustomerId!,
          payment_method: client.stripeDefaultPaymentMethodId!,
          off_session: true,
          confirm: true,
          // Solo testo descrittivo (servizi + cliente finale): importi invariati.
          description: autoChargeDescription(group),
        });
        paymentIntentId = pi.id;
        charged = pi.status === "succeeded";
        if (!charged) chargeError = `PaymentIntent status: ${pi.status}`;
      } catch (e) {
        chargeError = e instanceof Error ? e.message : "errore Stripe";
        const anyErr = e as { payment_intent?: { id?: string } };
        paymentIntentId = anyErr?.payment_intent?.id ?? null;
      }

      if (charged) {
        if (paymentIntentId) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { stripePaymentIntentId: paymentIntentId },
          });
        }
        // Percorso condiviso: rinnovo (indipendente per riga) + ricevuta + email.
        await confirmPaymentAndRenew(payment.id);
        await prisma.subscriptionItem.updateMany({
          where: { id: { in: group.map((it) => it.id) } },
          data: { autoChargeFailCount: 0, autoChargeLastAttemptAt: now },
        });
        succeeded += group.length;
        continue;
      }

      // ── Fallimento del gruppo ────────────────────────────────────────────
      failed += group.length;
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FALLITO",
          note: `Addebito automatico fallito: ${chargeError ?? "errore"}`,
        },
      });

      // failCount per riga: le righe che raggiungono 2 vengono disattivate.
      const disabledItems: EligibleItem[] = [];
      for (const it of group) {
        const newFailCount = it.autoChargeFailCount + 1;
        if (newFailCount >= 2) {
          await prisma.subscriptionItem.update({
            where: { id: it.id },
            data: {
              autoChargeEnabled: false,
              autoChargeFailCount: 0,
              autoChargeLastAttemptAt: now,
            },
          });
          disabledItems.push(it);
          disabledAfterRetries++;
        } else {
          await prisma.subscriptionItem.update({
            where: { id: it.id },
            data: {
              autoChargeFailCount: newFailCount,
              autoChargeLastAttemptAt: now,
            },
          });
        }
      }

      // Per le righe disattivate: un unico link manuale di fallback + notifica.
      if (disabledItems.length > 0) {
        if (appUrl) {
          try {
            await createCheckoutPayment(
              {
                subscriptionId: first.subscriptionId,
                clientEmail: client.email,
                serviceFeeEnabled: first.subscription.serviceFeeEnabled,
                items: disabledItems.map((it) => ({
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
                  },
                  endClientName: it.endClientName,
                })),
              },
              appUrl,
              { sendToClient: true },
            );
          } catch (e) {
            console.error(
              `[cron auto-charge] fallback link fallito (sub ${first.subscriptionId}):`,
              e,
            );
          }
        }

        const clientName = client.ragioneSociale?.trim()
          ? client.ragioneSociale
          : client.name;
        // Notifica multi-riga: elenca i servizi disattivati del gruppo con il
        // motivo comune del fallimento dell'addebito.
        await sendEmail(
          buildAutoChargeFailedAdminEmail({
            subscriptionId: first.subscriptionId,
            clientName,
            items: disabledItems.map((it) => ({
              serviceName: it.service.name,
              endClientName: it.endClientName,
            })),
            reason: chargeError,
          }),
        );
      }
    } catch (e) {
      console.error(
        `[cron auto-charge] errore su gruppo (sub ${first.subscriptionId}):`,
        e,
      );
    }
  }

  return NextResponse.json({
    charges,
    attempted,
    succeeded,
    failed,
    disabledAfterRetries,
  });
}
