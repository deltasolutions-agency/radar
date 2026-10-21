import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";
import { createCheckoutPayment, toCheckoutItem } from "@/lib/payment-checkout";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { sendEmail } from "@/lib/send-email";
import {
  buildAutoChargeFailedAdminEmail,
  buildCronSummaryEmail,
} from "@/lib/email-templates";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import { formatDate, formatEur } from "@/lib/format";
import { withEndClient } from "@/lib/end-client";
import { clientDisplayName, serviceLabel, type CronResult } from "@/lib/cron/common";
import {
  AUTOCHARGE_MAX_DELAY_DAYS,
  EXCLUSION_LABELS,
  planAutoCharge,
  type AutoChargeItem,
  type AutoChargePlan,
  type PlannedCharge,
} from "@/lib/cron/auto-charge-plan";

function itemLine(it: AutoChargeItem): string {
  return `${clientDisplayName(it.subscription.client)} · ${withEndClient(serviceLabel(it), it.endClientName)} · scadenza ${formatDate(it.endDate)}`;
}

function chargeDetail(c: PlannedCharge, extra: Record<string, unknown> = {}) {
  return {
    subscriptionId: c.subscriptionId,
    client: clientDisplayName(c.client),
    dueDate: c.endDate.toISOString().slice(0, 10),
    items: c.items.map((it, i) => ({
      id: it.id,
      service: serviceLabel(it),
      endClientName: it.endClientName,
      netCents: renewalChargePriceCents(it) * it.quantity,
      grossCents: c.itemGrossCents[i],
    })),
    servicesCents: c.servicesCents,
    serviceFeeCents: c.serviceFeeCents,
    totalCents: c.totalCents,
    idempotencyKey: c.idempotencyKey,
    ...extra,
  };
}

function exclusionDetails(plan: AutoChargePlan) {
  return [
    ...plan.excluded.map((e) => ({
      outcome: "EXCLUDED",
      reason: e.reason,
      itemId: e.item.id,
      subscriptionId: e.item.subscriptionId,
      lateDays: e.lateDays,
    })),
    ...plan.toDisable.map((it) => ({ outcome: "DISABLE_EXPIRED", itemId: it.id })),
    ...plan.attemptedToday.map((it) => ({ outcome: "ALREADY_ATTEMPTED_TODAY", itemId: it.id })),
  ];
}

/** Esegue (o simula, con dryRun) il cron auto-charge. */
export async function runAutoCharge({
  now,
  dryRun,
}: {
  now: Date;
  dryRun: boolean;
}): Promise<CronResult> {
  const plan = await planAutoCharge(now);
  const skippedCount = plan.excluded.length + plan.attemptedToday.length + plan.toDisable.length;

  if (dryRun) {
    return {
      dryRun: true,
      candidates: plan.candidates,
      sent: 0,
      skipped: skippedCount,
      failed: 0,
      wouldCharge: plan.charges.length,
      details: [
        ...plan.charges.map((c) => chargeDetail(c, { outcome: "WOULD_CHARGE" })),
        ...exclusionDetails(plan),
      ],
    };
  }

  const stripe = getStripe();
  const appUrl = process.env.APP_URL;
  let succeeded = 0;
  let failed = 0;
  let disabledAfterRetries = 0;
  const details: Record<string, unknown>[] = [];
  const summaryCharged: string[] = [];
  const summaryFailed: string[] = [];
  const summaryReconcile: string[] = [];

  // ── Auto-charge con data di fine superata → torna a gestione manuale ──────
  for (const it of plan.toDisable) {
    try {
      await prisma.subscriptionItem.update({
        where: { id: it.id },
        data: { autoChargeEnabled: false },
      });
    } catch (e) {
      console.error(`[cron auto-charge] disattivazione item ${it.id}:`, e);
    }
  }

  // ── Un addebito per gruppo ────────────────────────────────────────────────
  for (const c of plan.charges) {
    const ids = c.items.map((it) => it.id);
    const label = `${clientDisplayName(c.client)} · ${c.items.map((it) => withEndClient(serviceLabel(it), it.endClientName)).join(", ")} · ${formatEur(c.totalCents, c.currency)}`;
    try {
      // Tentativo registrato PRIMA della chiamata Stripe: un nuovo run nello
      // stesso giorno non ritenta, qualunque cosa accada dopo.
      await prisma.subscriptionItem.updateMany({
        where: { id: { in: ids } },
        data: { autoChargeLastAttemptAt: now },
      });

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: c.subscriptionId,
          amountCents: c.totalCents,
          serviceFeeCents: c.serviceFeeCents,
          currency: c.currency,
          method: "STRIPE",
          status: "IN_ATTESA",
          items: {
            create: c.items.map((it, idx) => {
              const duration = periodDurationDays(it);
              return {
                subscriptionItemId: it.id,
                amountCents: c.itemGrossCents[idx],
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

      let charged = false;
      let chargeError: string | undefined;
      let paymentIntentId: string | null = null;
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: c.totalCents,
            currency: c.currency,
            customer: c.client.stripeCustomerId!,
            payment_method: c.client.stripeDefaultPaymentMethodId!,
            off_session: true,
            confirm: true,
            // Solo testo descrittivo (servizi + cliente finale): importi invariati.
            description: c.description,
            metadata: { subscriptionId: c.subscriptionId, paymentId: payment.id },
          },
          { idempotencyKey: c.idempotencyKey },
        );
        paymentIntentId = pi.id;
        charged = pi.status === "succeeded";
        if (!charged) chargeError = `PaymentIntent status: ${pi.status}`;
      } catch (e) {
        chargeError = e instanceof Error ? e.message : "errore Stripe";
        const anyErr = e as { payment_intent?: { id?: string } };
        paymentIntentId = anyErr?.payment_intent?.id ?? null;
      }

      if (charged) {
        // ── Addebito riuscito: registra PI, rinnovo + ricevuta + email ───────
        try {
          if (paymentIntentId) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { stripePaymentIntentId: paymentIntentId },
            });
          }
          await confirmPaymentAndRenew(payment.id, "CRON");
          await prisma.subscriptionItem.updateMany({
            where: { id: { in: ids } },
            data: { autoChargeFailCount: 0 },
          });
          succeeded++;
          summaryCharged.push(label);
          details.push(chargeDetail(c, { outcome: "CHARGED", paymentId: payment.id, paymentIntentId }));
        } catch (e) {
          // Addebito avvenuto ma rinnovo/registrazione falliti: MAI riaddebitare
          // lo stesso periodo → riga "da riconciliare" + segnalazione admin.
          const msg = e instanceof Error ? e.message : String(e);
          const note = `Addebito riuscito (PaymentIntent ${paymentIntentId ?? "?"}) ma rinnovo non registrato: ${msg}`;
          console.error(`[cron auto-charge] da riconciliare (payment ${payment.id}):`, e);
          await prisma.subscriptionItem
            .updateMany({
              where: { id: { in: ids } },
              data: { autoChargeReconcileAt: now, autoChargeReconcileNote: note.slice(0, 1000) },
            })
            .catch((err) => console.error("[cron auto-charge] flag riconciliazione fallito:", err));
          await prisma.payment
            .update({ where: { id: payment.id }, data: { note: note.slice(0, 1000) } })
            .catch(() => undefined);
          summaryReconcile.push(`${label} — payment ${payment.id}: ${msg}`);
          details.push(chargeDetail(c, { outcome: "RECONCILE", paymentId: payment.id, paymentIntentId, error: msg }));
        }
        continue;
      }

      // ── Fallimento del gruppo ──────────────────────────────────────────────
      failed++;
      summaryFailed.push(`${label}: ${chargeError ?? "errore"}`);
      details.push(chargeDetail(c, { outcome: "FAILED", paymentId: payment.id, error: chargeError }));
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FALLITO",
          note: `Addebito automatico fallito: ${chargeError ?? "errore"}`,
        },
      });

      // failCount per riga: le righe che raggiungono 2 vengono disattivate.
      const disabledItems: AutoChargeItem[] = [];
      for (const it of c.items) {
        const newFailCount = it.autoChargeFailCount + 1;
        if (newFailCount >= 2) {
          await prisma.subscriptionItem.update({
            where: { id: it.id },
            data: { autoChargeEnabled: false, autoChargeFailCount: 0 },
          });
          disabledItems.push(it);
          disabledAfterRetries++;
        } else {
          await prisma.subscriptionItem.update({
            where: { id: it.id },
            data: { autoChargeFailCount: newFailCount },
          });
        }
      }

      // Per le righe disattivate: un unico link manuale di fallback + notifica.
      if (disabledItems.length > 0) {
        if (appUrl) {
          try {
            await createCheckoutPayment(
              {
                subscriptionId: c.subscriptionId,
                clientEmail: c.client.email,
                serviceFeeEnabled: c.items[0].subscription.serviceFeeEnabled,
                items: disabledItems.map(toCheckoutItem),
              },
              appUrl,
              { sendToClient: true, trigger: "CRON" },
            );
          } catch (e) {
            console.error(`[cron auto-charge] fallback link fallito (sub ${c.subscriptionId}):`, e);
          }
        }
        await sendEmail(
          buildAutoChargeFailedAdminEmail({
            subscriptionId: c.subscriptionId,
            clientName: clientDisplayName(c.client),
            items: disabledItems.map((it) => ({
              serviceName: it.service.name,
              endClientName: it.endClientName,
            })),
            reason: chargeError,
          }),
          undefined,
          {
            type: "AUTOCHARGE_FAILED",
            trigger: "CRON",
            clientId: c.client.id,
            subscriptionId: c.subscriptionId,
            dueDate: c.endDate,
            itemIds: disabledItems.map((it) => it.id),
          },
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron auto-charge] errore su gruppo (sub ${c.subscriptionId}):`, e);
      failed++;
      summaryFailed.push(`${label}: ${msg}`);
      details.push(chargeDetail(c, { outcome: "ERROR", error: msg }));
    }
  }

  // ── Riepilogo admin (una email per esecuzione, solo se c'è qualcosa) ──────
  const excludedLines = plan.excluded.map(
    (e) => `${itemLine(e.item)} — ${EXCLUSION_LABELS[e.reason]}${e.reason === "TOO_LATE" ? ` (${e.lateDays} gg)` : ""}`,
  );
  const disabledLines = plan.toDisable.map((it) => `${itemLine(it)} — fine rinnovo automatico superata`);
  if (plan.charges.length + excludedLines.length + disabledLines.length > 0) {
    await sendEmail(
      buildCronSummaryEmail({
        subject: `[Radar] Riepilogo addebiti automatici ${formatDate(now)}: ${succeeded} riusciti${failed ? `, ${failed} falliti` : ""}${summaryReconcile.length ? `, ${summaryReconcile.length} da riconciliare` : ""}`,
        title: "Riepilogo cron addebiti automatici",
        intro: `Esecuzione del ${now.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}. Le righe escluse richiedono una gestione manuale (si addebitano solo scadenze con ritardo ≤ ${AUTOCHARGE_MAX_DELAY_DAYS} giorni).`,
        sections: [
          { heading: "Addebiti riusciti", lines: summaryCharged },
          { heading: "Addebiti falliti", lines: summaryFailed },
          { heading: "DA RICONCILIARE (addebito avvenuto, rinnovo non registrato)", lines: summaryReconcile },
          { heading: "Escluse dall'addebito — gestione manuale", lines: excludedLines },
          { heading: "Rinnovo automatico disattivato (data di fine superata)", lines: disabledLines },
        ],
      }),
      undefined,
      { type: "ADMIN_SUMMARY", trigger: "CRON" },
    );
  }

  return {
    dryRun: false,
    candidates: plan.candidates,
    sent: succeeded,
    skipped: skippedCount,
    failed,
    charges: plan.charges.length,
    reconcile: summaryReconcile.length,
    disabledAfterRetries,
    details: [...details, ...exclusionDetails(plan)],
  };
}
