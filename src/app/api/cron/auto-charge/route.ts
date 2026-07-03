import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";
import { createCheckoutPayment } from "@/lib/payment-checkout";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeFailedAdminEmail } from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOCKING = ["CESSATO", "SOSPESO"] as const;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Chiave-giorno locale di una data (per raggruppare le righe con pari scadenza). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Riga idonea all'addebito, con relazioni caricate.
type EligibleItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

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

  const candidates = await prisma.subscriptionItem.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      subscription: {
        client: { stripeDefaultPaymentMethodId: { not: null } },
      },
    },
    include: {
      service: true,
      subscription: { include: { client: true } },
    },
  });

  // ── 1. Pre-filtro per riga → righe realmente addebitabili ─────────────────
  const eligible: EligibleItem[] = [];
  for (const item of candidates) {
    try {
      const client = item.subscription.client;

      // Auto-charge scaduto → torna a gestione manuale, nient'altro in questo run.
      if (
        item.autoChargeEndDate &&
        item.autoChargeEndDate.getTime() < now.getTime()
      ) {
        await prisma.subscriptionItem.update({
          where: { id: item.id },
          data: { autoChargeEnabled: false },
        });
        continue;
      }

      // Non ancora scaduto → non è il momento di addebitare.
      if (item.endDate.getTime() > now.getTime()) continue;

      // Già tentato oggi → evita doppio tentativo (anche doppio addebito).
      if (
        item.autoChargeLastAttemptAt &&
        isSameDay(item.autoChargeLastAttemptAt, now)
      ) {
        continue;
      }

      // Servono customer + metodo di pagamento salvati (sul Client).
      if (!client.stripeCustomerId || !client.stripeDefaultPaymentMethodId) {
        continue;
      }

      eligible.push(item);
    } catch (e) {
      console.error(`[cron auto-charge] pre-filtro item ${item.id}:`, e);
    }
  }

  // ── 2. Raggruppa per (abbonamento, valuta, giorno di scadenza) ────────────
  // Payment.subscriptionId lega un pagamento a un solo abbonamento: il gruppo
  // massimo è quindi per-abbonamento. Una PaymentIntent ha una sola valuta.
  const groups = new Map<string, EligibleItem[]>();
  for (const item of eligible) {
    const key = `${item.subscriptionId}|${item.currency}|${dayKey(item.endDate)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  // ── 3. Un addebito per gruppo ─────────────────────────────────────────────
  for (const group of groups.values()) {
    const first = group[0];
    const client = first.subscription.client;
    const currency = first.currency;
    const totalCents = group.reduce((sum, it) => sum + it.priceCents, 0);
    attempted += group.length;
    charges++;

    try {
      // Payment IN_ATTESA con una PaymentItem per riga del gruppo.
      const payment = await prisma.payment.create({
        data: {
          subscriptionId: first.subscriptionId,
          amountCents: totalCents,
          currency,
          method: "STRIPE",
          status: "IN_ATTESA",
          items: {
            create: group.map((it) => {
              const duration = periodDurationDays(it);
              return {
                subscriptionItemId: it.id,
                amountCents: it.priceCents,
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
                items: disabledItems.map((it) => ({
                  id: it.id,
                  currency: it.currency,
                  priceCents: it.priceCents,
                  endDate: it.endDate,
                  billingPeriod: it.billingPeriod,
                  customPeriodDays: it.customPeriodDays,
                  service: {
                    name: it.service.name,
                    description: it.service.description,
                  },
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
