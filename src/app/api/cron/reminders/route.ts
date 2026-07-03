import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
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

  // ── 1. RICALCOLO STATUS PER RIGA (prima dei reminder) ──────────────────────
  let statusUpdated = 0;
  const toRecalc = await prisma.subscriptionItem.findMany({
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
  for (const item of toRecalc) {
    const newStatus = computeItemStatus(item);
    if (newStatus !== item.status) {
      try {
        await prisma.subscriptionItem.update({
          where: { id: item.id },
          data: { status: newStatus },
        });
        statusUpdated++;
      } catch (e) {
        console.error(`[cron] ricalcolo status fallito per item ${item.id}:`, e);
      }
    }
  }

  // ── 2. REMINDER + CESSAZIONE (per riga) ────────────────────────────────────
  let remindersSent = 0;
  let remindersSkipped = 0;
  let remindersFailed = 0;
  let cessations = 0;

  const now = new Date();
  const dedupeKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const items = await prisma.subscriptionItem.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    include: {
      service: true,
      subscription: { include: { client: true } },
    },
  });

  for (const item of items) {
    try {
      const milestone = getReminderMilestone({
        endDate: item.endDate,
        billingPeriod: item.billingPeriod,
        customPeriodDays: item.customPeriodDays,
      });
      if (!milestone) continue;

      // Dedupe: già inviato oggi per questo type/riga?
      const existing = await prisma.notificationLog.findFirst({
        where: {
          subscriptionItemId: item.id,
          type: milestone.type,
          dedupeKey,
        },
        select: { id: true },
      });
      if (existing) {
        remindersSkipped++;
        continue;
      }

      const diffDays = Math.ceil(
        (item.endDate.getTime() - now.getTime()) / MS_PER_DAY,
      );
      const client = item.subscription.client;
      const clientName = client.ragioneSociale?.trim()
        ? client.ragioneSociale
        : client.name;

      const content = buildReminderEmail(milestone.type, {
        subscriptionId: item.subscriptionId,
        clientName,
        serviceName: item.service.name,
        endDate: item.endDate,
        diffDays,
      });

      // Invio (non lancia mai).
      const sent = await sendEmail(content);
      const recipient = process.env.ADMIN_EMAIL ?? "(non configurato)";

      const logData = {
        subscriptionItemId: item.id,
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
          prisma.subscriptionItem.updateMany({
            where: { id: item.id, status: { notIn: [...BLOCKING] } },
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
      // Un errore su una riga non blocca le altre.
      console.error(`[cron] errore su subscription item ${item.id}:`, e);
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
