import { NextResponse, type NextRequest } from "next/server";
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

// GET /api/cron/auto-charge — addebito automatico ricorrente (off_session).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const now = new Date();
  const stripe = getStripe();
  const appUrl = process.env.APP_URL;

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let disabledAfterRetries = 0;

  const subs = await prisma.subscription.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      client: { stripeDefaultPaymentMethodId: { not: null } },
    },
    include: { client: true, service: true },
  });

  for (const sub of subs) {
    try {
      const client = sub.client;

      // Auto-charge scaduto → torna a gestione manuale, nient'altro in questo run.
      if (sub.autoChargeEndDate && sub.autoChargeEndDate.getTime() < now.getTime()) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { autoChargeEnabled: false },
        });
        continue;
      }

      // Non ancora scaduto → non è il momento di addebitare.
      if (sub.endDate.getTime() > now.getTime()) continue;

      // Già tentato oggi → evita doppio tentativo.
      if (
        sub.autoChargeLastAttemptAt &&
        isSameDay(sub.autoChargeLastAttemptAt, now)
      ) {
        continue;
      }

      // Servono customer + metodo di pagamento salvati.
      if (!client.stripeCustomerId || !client.stripeDefaultPaymentMethodId) {
        continue;
      }

      attempted++;

      // Payment IN_ATTESA con il periodo coperto (endDate → endDate + durata).
      const duration = periodDurationDays(sub);
      const periodStart = sub.endDate;
      const periodEnd =
        duration != null
          ? new Date(sub.endDate.getTime() + duration * MS_PER_DAY)
          : null;

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          amountCents: sub.priceCents,
          currency: sub.currency,
          method: "STRIPE",
          status: "IN_ATTESA",
          periodStart,
          periodEnd,
        },
      });

      // Tentativo di addebito off_session.
      let charged = false;
      let chargeError: string | undefined;
      let paymentIntentId: string | null = null;
      try {
        const pi = await stripe.paymentIntents.create({
          amount: sub.priceCents,
          currency: sub.currency,
          customer: client.stripeCustomerId,
          payment_method: client.stripeDefaultPaymentMethodId,
          off_session: true,
          confirm: true,
        });
        paymentIntentId = pi.id;
        charged = pi.status === "succeeded";
        if (!charged) chargeError = `PaymentIntent status: ${pi.status}`;
      } catch (e) {
        chargeError = e instanceof Error ? e.message : "errore Stripe";
        // L'errore off_session può portare l'id del PaymentIntent.
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
        // Percorso condiviso: rinnovo + ricevuta + email di conferma.
        await confirmPaymentAndRenew(payment.id);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { autoChargeFailCount: 0, autoChargeLastAttemptAt: now },
        });
        succeeded++;
        continue;
      }

      // ── Fallimento ─────────────────────────────────────────────────────────
      failed++;
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FALLITO",
          note: `Addebito automatico fallito: ${chargeError ?? "errore"}`,
        },
      });

      const newFailCount = sub.autoChargeFailCount + 1;

      if (newFailCount >= 2) {
        // Secondo fallimento: disattiva, reset contatore, link manuale + notifica.
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            autoChargeEnabled: false,
            autoChargeFailCount: 0,
            autoChargeLastAttemptAt: now,
          },
        });
        disabledAfterRetries++;

        if (appUrl) {
          try {
            await createCheckoutPayment(sub, appUrl, { sendToClient: true });
          } catch (e) {
            console.error(
              `[cron auto-charge] fallback link fallito per ${sub.id}:`,
              e,
            );
          }
        }

        const clientName = sub.client.ragioneSociale?.trim()
          ? sub.client.ragioneSociale
          : sub.client.name;
        await sendEmail(
          buildAutoChargeFailedAdminEmail({
            subscriptionId: sub.id,
            clientName,
            serviceName: sub.service.name,
          }),
        );
      } else {
        // Primo fallimento: il prossimo run ritenterà.
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            autoChargeFailCount: newFailCount,
            autoChargeLastAttemptAt: now,
          },
        });
      }
    } catch (e) {
      console.error(`[cron auto-charge] errore su subscription ${sub.id}:`, e);
    }
  }

  return NextResponse.json({
    attempted,
    succeeded,
    failed,
    disabledAfterRetries,
  });
}
