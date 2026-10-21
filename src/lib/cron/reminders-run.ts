import "server-only";
import type { NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildAutoChargeUpcomingEmail,
  buildCronSummaryEmail,
  buildReminderEmail,
  type ClientRenewalInfo,
  type EmailContent,
} from "@/lib/email-templates";
import { createCheckoutPayment, toCheckoutItem } from "@/lib/payment-checkout";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { sendEmail } from "@/lib/send-email";
import { purgeOldEmailLogs } from "@/lib/email-log-retention";
import {
  loadReminderTemplates,
  type ReminderTemplateMap,
} from "@/lib/reminder-settings";
import { formatDate, formatEur } from "@/lib/format";
import { withEndClient } from "@/lib/end-client";
import { itemSummary, serviceLabel, type CronResult } from "@/lib/cron/common";
import {
  BLOCKING,
  NO_EMAIL_RECIPIENT,
  REMINDER_RECOVERY_DAYS,
  groupServicesLabel,
  milestoneLabel,
  milestoneLogKey,
  planReminders,
  type PlannedGroup,
  type ReminderPlan,
} from "@/lib/cron/reminders-plan";

function groupDetail(g: PlannedGroup, extra: Record<string, unknown> = {}) {
  return {
    subscriptionId: g.subscriptionId,
    client: g.clientName,
    services: groupServicesLabel(g),
    recipient: g.clientEmail,
    note: milestoneLabel(g),
    milestone: g.type,
    offset: g.offset,
    daysLate: g.daysLate,
    dueDate: g.endDate.toISOString().slice(0, 10),
    items: g.items.map((it) => ({
      id: it.id,
      service: serviceLabel(it),
      endClientName: it.endClientName,
    })),
    netCents: g.amounts.netCents,
    grossCents: g.amounts.grossCents,
    cessation: g.isCessation,
    ...extra,
  };
}

/** Righe con "scade oggi" non inviato perché coperte dall'addebito delle 9:00. */
function autoChargeTodayDetails(plan: ReminderPlan) {
  return plan.autoChargeToday.map((it) => ({
    outcome: "SKIPPED_AUTOCHARGE_TODAY",
    ...itemSummary(it),
    note: "scade oggi: coperta dall'addebito automatico delle 9:00",
  }));
}

/** Arretrati: milestone non inviata da oltre la finestra di recupero. */
function backlogDetails(plan: ReminderPlan) {
  return plan.backlog.map((b) => ({
    outcome: "BACKLOG",
    ...itemSummary(b.item),
    milestone: b.type,
    offset: b.offset,
    daysLate: b.daysLate,
    note: `${milestoneLabel(b)} non inviata da ${b.daysLate} gg`,
  }));
}

/** Esito dry-run: il piano, senza invii/addebiti/scritture. */
function dryRunResult(plan: ReminderPlan): CronResult {
  return {
    dryRun: true,
    candidates: plan.candidates,
    sent: 0,
    skipped: plan.alreadySent + plan.autoChargeToday.length,
    failed: 0,
    wouldSend: plan.groups.length,
    statusChanges: plan.statusChanges.length,
    backlog: plan.backlog.length,
    details: [
      ...plan.groups.map((g) =>
        groupDetail(g, {
          outcome: g.clientEmail ? "WOULD_SEND" : "NO_EMAIL",
          wouldCreatePaymentLink:
            g.kind === "REMINDER" && !g.autoCharge && !!g.clientEmail && !g.reusablePayToken && !!process.env.APP_URL,
          wouldCreateAutoChargeRequest:
            g.kind === "REMINDER" && !g.autoCharge && !!g.clientEmail && !g.isCessation && !g.reusableAutoChargeToken && !!process.env.APP_URL,
        }),
      ),
      ...autoChargeTodayDetails(plan),
      ...backlogDetails(plan),
    ],
  };
}

/** Link di pagamento (riuso o nuovo Payment) per le righe del gruppo. */
async function ensurePayUrl(g: PlannedGroup, appUrl: string): Promise<string | null> {
  if (g.reusablePayToken) return `${appUrl}/pay/${g.reusablePayToken}`;
  try {
    const result = await createCheckoutPayment(
      {
        subscriptionId: g.subscriptionId,
        clientEmail: g.clientEmail,
        serviceFeeEnabled: g.serviceFeeEnabled,
        items: g.items.map(toCheckoutItem),
      },
      appUrl,
      { sendToClient: false, trigger: "CRON" },
    );
    return `${appUrl}/pay/${result.payment.payToken}`;
  } catch (e) {
    // Non deve bloccare l'invio del reminder: si invia senza CTA di pagamento.
    console.error(`[cron reminders] link pagamento fallito (sub ${g.subscriptionId}):`, e);
    return null;
  }
}

/** Link di attivazione rinnovo automatico (riuso o nuova richiesta) per il gruppo. */
async function ensureAutoChargeUrl(g: PlannedGroup, appUrl: string): Promise<string> {
  const token =
    g.reusableAutoChargeToken ??
    (
      await prisma.autoChargeRequest.create({
        data: { clientId: g.clientId, itemIds: g.items.map((it) => it.id) },
        select: { token: true },
      })
    ).token;
  return `${appUrl}/attiva-rinnovo/${token}`;
}

/** Contenuto dell'email al cliente per il gruppo. */
async function buildGroupEmail(
  g: PlannedGroup,
  templates: ReminderTemplateMap,
): Promise<EmailContent> {
  const items = g.items.map((it) => ({
    serviceName: it.service.name,
    endClientName: it.endClientName,
  }));
  if (g.kind === "PREAVVISO") {
    // Importi calcolati come il cron auto-charge (groupAmounts).
    return buildAutoChargeUpcomingEmail({
      items,
      endDate: g.endDate,
      netCents: g.amounts.netCents,
      vatCents: g.amounts.vatCents,
      serviceFeeCents: g.amounts.serviceFeeCents,
      totalCents: g.amounts.totalCents,
      currency: g.currency,
    });
  }
  let clientRenewal: ClientRenewalInfo | undefined;
  if (!g.autoCharge) {
    const appUrl = process.env.APP_URL;
    clientRenewal = {
      // Netto del PROSSIMO rinnovo (aumento ONCE incluso se dovuto).
      itemNetCents: g.items.map((it) => renewalChargePriceCents(it) * it.quantity),
      currency: g.currency,
      payUrl: appUrl ? await ensurePayUrl(g, appUrl) : null,
      autoChargeUrl: appUrl && !g.isCessation ? await ensureAutoChargeUrl(g, appUrl) : null,
    };
  }
  return buildReminderEmail(
    g.type,
    {
      subscriptionId: g.subscriptionId,
      clientName: g.clientName,
      items,
      endDate: g.endDate,
      diffDays: g.diffDays,
    },
    { audience: "client", clientRenewal, override: templates[g.type] },
  );
}

/** Registra l'esito per ogni riga del gruppo (NotificationLog per milestone). */
async function logGroupOutcome(
  g: PlannedGroup,
  status: NotificationStatus,
  recipient: string,
  resendId: string | undefined,
  error: string | undefined,
): Promise<void> {
  const dedupeKey = milestoneLogKey(g.endDate, g.offset);
  for (const it of g.items) {
    await prisma.notificationLog.upsert({
      where: {
        subscriptionItemId_type_dedupeKey: {
          subscriptionItemId: it.id,
          type: g.type,
          dedupeKey,
        },
      },
      create: {
        subscriptionItemId: it.id,
        type: g.type,
        status,
        recipient,
        resendId,
        error,
        dedupeKey,
      },
      update: { status, recipient, resendId: resendId ?? null, error: error ?? null, sentAt: new Date() },
    });
  }
}

/** Esegue (o simula, con dryRun) il cron reminder. */
export async function runReminders({
  now,
  dryRun,
}: {
  now: Date;
  dryRun: boolean;
}): Promise<CronResult> {
  const plan = await planReminders(now);
  if (dryRun) return dryRunResult(plan);

  // ── 1. Ricalcolo status ────────────────────────────────────────────────────
  let statusUpdated = 0;
  for (const c of plan.statusChanges) {
    try {
      await prisma.subscriptionItem.updateMany({
        where: { id: c.id, status: { notIn: [...BLOCKING] } },
        data: { status: c.to },
      });
      statusUpdated++;
    } catch (e) {
      console.error(`[cron reminders] ricalcolo status fallito per item ${c.id}:`, e);
    }
  }

  // ── 2. Invii per gruppo + cessazioni ───────────────────────────────────────
  const templates = await loadReminderTemplates();
  let sent = 0;
  let skipped = plan.alreadySent + plan.autoChargeToday.length;
  let failed = 0;
  let cessations = 0;
  const details: Record<string, unknown>[] = [];
  const summarySent: string[] = [];
  const summaryErrors: string[] = [];
  const summaryCessations: string[] = [];

  for (const g of plan.groups) {
    const line = `${g.clientName} · ${groupServicesLabel(g)} · ${milestoneLabel(g)} · scadenza ${formatDate(g.endDate)}`;
    try {
      if (!g.clientEmail) {
        await logGroupOutcome(g, "FALLITA", NO_EMAIL_RECIPIENT, undefined, "Cliente senza indirizzo email");
        failed++;
        summaryErrors.push(`${line} → cliente senza email`);
        details.push(groupDetail(g, { outcome: "NO_EMAIL" }));
      } else {
        const content = await buildGroupEmail(g, templates);
        const res = await sendEmail(content, g.clientEmail, {
          type: g.kind === "PREAVVISO" ? "AUTOCHARGE_NOTICE" : "REMINDER",
          trigger: "CRON",
          clientId: g.clientId,
          subscriptionId: g.subscriptionId,
          dueDate: g.endDate,
          itemIds: g.items.map((it) => it.id),
          dedupeKey: g.emailDedupeKey,
        });
        await logGroupOutcome(g, res.status, g.clientEmail, res.resendId, res.error);
        if (res.skipped) {
          skipped++;
          details.push(groupDetail(g, { outcome: "SKIPPED", emailLogId: res.logId }));
        } else if (res.ok) {
          sent++;
          summarySent.push(`${line} → ${g.clientEmail}`);
          details.push(groupDetail(g, { outcome: "SENT", emailLogId: res.logId }));
        } else {
          failed++;
          summaryErrors.push(`${line} → ${g.clientEmail}: ${res.error ?? "errore"}`);
          details.push(groupDetail(g, { outcome: "FAILED", error: res.error, emailLogId: res.logId }));
        }
      }

      // Cessazione: indipendente dall'esito dell'email, idempotente sullo stato.
      if (g.isCessation) {
        const r = await prisma.subscriptionItem.updateMany({
          where: { id: { in: g.items.map((it) => it.id) }, status: { notIn: [...BLOCKING] } },
          data: { status: "CESSATO" },
        });
        if (r.count > 0) {
          cessations += r.count;
          summaryCessations.push(line);
        }
      }
    } catch (e) {
      // Un errore su un gruppo non blocca gli altri.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron reminders] errore gruppo (sub ${g.subscriptionId}):`, e);
      failed++;
      summaryErrors.push(`${line}: ${msg}`);
      details.push(groupDetail(g, { outcome: "ERROR", error: msg }));
    }
  }

  const backlogLines = plan.backlog.map(
    (b) =>
      `${b.item.subscription.client.ragioneSociale?.trim() || b.item.subscription.client.name} · ${withEndClient(serviceLabel(b.item), b.item.endClientName)} · ${milestoneLabel(b)} non inviata da ${b.daysLate} gg · scadenza ${formatDate(b.item.endDate)} · ${formatEur(renewalChargePriceCents(b.item) * b.item.quantity, b.item.currency)} netti`,
  );
  details.push(...autoChargeTodayDetails(plan));
  details.push(...backlogDetails(plan));

  // ── 3. Riepilogo admin (solo se qualcosa è partito o è fallito) ───────────
  if (sent + failed > 0) {
    await sendEmail(
      buildCronSummaryEmail({
        subject: `[Radar] Riepilogo reminder ${formatDate(now)}: ${sent} inviati${failed ? `, ${failed} errori` : ""}`,
        title: "Riepilogo cron reminder",
        intro: `Esecuzione del ${now.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}: ${sent} email inviate, ${failed} errori, ${skipped} già inviate/saltate.`,
        sections: [
          { heading: "Email inviate", lines: summarySent },
          { heading: "Errori", lines: summaryErrors },
          { heading: "Servizi cessati per morosità", lines: summaryCessations },
          {
            heading: `Arretrati esclusi (milestone non inviata da più di ${REMINDER_RECOVERY_DAYS} giorni — nessuna email)`,
            lines: backlogLines,
          },
        ],
      }),
      undefined,
      { type: "ADMIN_SUMMARY", trigger: "CRON" },
    );
  }

  // ── 4. Retention EmailLog ──────────────────────────────────────────────────
  let emailLogsPurged = 0;
  try {
    emailLogsPurged = await purgeOldEmailLogs(now);
  } catch (e) {
    console.error("[cron reminders] retention EmailLog fallita:", e);
  }

  return {
    dryRun: false,
    candidates: plan.candidates,
    sent,
    skipped,
    failed,
    statusUpdated,
    cessations,
    backlog: plan.backlog.length,
    emailLogsPurged,
    details,
  };
}
