import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSubscriptionStatus } from "@/lib/subscription-status";
import { getReminderMilestone } from "@/lib/reminder-schedule";
import { buildReminderEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Stati manuali bloccanti: mai toccati dal cron.
const BLOCKING = ["CESSATO", "SOSPESO"] as const;

export async function GET(request: NextRequest) {
  // ── Auth: Bearer CRON_SECRET ───────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  // ── 1. RICALCOLO STATUS (prima dei reminder) ───────────────────────────────
  let statusUpdated = 0;
  const toRecalc = await prisma.subscription.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    select: {
      id: true,
      status: true,
      endDate: true,
      billingPeriod: true,
      customPeriodDays: true,
      lastRenewalAt: true,
    },
  });
  for (const sub of toRecalc) {
    const newStatus = computeSubscriptionStatus(sub);
    if (newStatus !== sub.status) {
      try {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: newStatus },
        });
        statusUpdated++;
      } catch (e) {
        console.error(`[cron] ricalcolo status fallito per ${sub.id}:`, e);
      }
    }
  }

  // ── 2. REMINDER + CESSAZIONE ───────────────────────────────────────────────
  let remindersSent = 0;
  let remindersSkipped = 0;
  let remindersFailed = 0;
  let cessations = 0;

  const now = new Date();
  const dedupeKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const subs = await prisma.subscription.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    include: { client: true, service: true },
  });

  for (const sub of subs) {
    try {
      const milestone = getReminderMilestone({
        endDate: sub.endDate,
        billingPeriod: sub.billingPeriod,
        customPeriodDays: sub.customPeriodDays,
      });
      if (!milestone) continue;

      // Dedupe: già inviato oggi per questo type?
      const existing = await prisma.notificationLog.findFirst({
        where: { subscriptionId: sub.id, type: milestone.type, dedupeKey },
        select: { id: true },
      });
      if (existing) {
        remindersSkipped++;
        continue;
      }

      const diffDays = Math.ceil(
        (sub.endDate.getTime() - now.getTime()) / MS_PER_DAY,
      );
      const clientName = sub.client.ragioneSociale?.trim()
        ? sub.client.ragioneSociale
        : sub.client.name;

      const content = buildReminderEmail(milestone.type, {
        subscriptionId: sub.id,
        clientName,
        serviceName: sub.service.name,
        endDate: sub.endDate,
        diffDays,
      });

      // Invio (non lancia mai).
      const sent = await sendEmail(content);
      const recipient = process.env.ADMIN_EMAIL ?? "(non configurato)";

      const logData = {
        subscriptionId: sub.id,
        type: milestone.type,
        status: sent.status,
        recipient,
        resendId: sent.resendId,
        error: sent.error,
        dedupeKey,
      };

      if (milestone.isCessationTrigger) {
        // Cessazione + log nella STESSA transazione: mai l'una senza l'altro.
        // Un fallimento email NON impedisce la cessazione (caso critico).
        await prisma.$transaction([
          prisma.notificationLog.create({ data: logData }),
          prisma.subscription.updateMany({
            where: { id: sub.id, status: { notIn: [...BLOCKING] } },
            data: { status: "CESSATO" },
          }),
        ]);
        cessations++;
      } else {
        await prisma.notificationLog.create({ data: logData });
      }

      if (sent.status === "INVIATA") remindersSent++;
      else remindersFailed++;
    } catch (e) {
      // Un errore su un abbonamento non blocca gli altri.
      console.error(`[cron] errore su subscription ${sub.id}:`, e);
      remindersFailed++;
    }
  }

  return NextResponse.json({
    statusUpdated,
    remindersSent,
    remindersSkipped,
    remindersFailed,
    cessations,
  });
}
