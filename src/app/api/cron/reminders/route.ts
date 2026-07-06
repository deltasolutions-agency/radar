import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { getReminderMilestone } from "@/lib/reminder-schedule";
import { buildReminderEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { addVatToNet } from "@/lib/vat";
import {
  loadReminderThresholds,
  loadReminderTemplates,
} from "@/lib/reminder-settings";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Stati manuali bloccanti: mai toccati dal cron.
const BLOCKING = ["CESSATO", "SOSPESO"] as const;

/**
 * Restituisce il token di una AutoChargeRequest pendente (non usata) che copre
 * l'item indicato, creandone una nuova (solo quell'item) se non esiste. Usato
 * per la CTA "attiva rinnovo automatico" nei reminder cliente (Caso A).
 */
async function ensureAutoChargeRequestToken(
  clientId: string,
  itemId: string,
): Promise<string> {
  const existing = await prisma.autoChargeRequest.findFirst({
    where: { clientId, usedAt: null, itemIds: { has: itemId } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  if (existing) return existing.token;
  const created = await prisma.autoChargeRequest.create({
    data: { clientId, itemIds: [itemId] },
    select: { token: true },
  });
  return created.token;
}

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

  // Soglie + override testuali configurabili (con fallback ai default).
  const [settings, templates] = await Promise.all([
    loadReminderThresholds(),
    loadReminderTemplates(),
  ]);

  const items = await prisma.subscriptionItem.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    include: {
      service: true,
      subscription: { include: { client: true } },
    },
  });

  const adminRecipient = process.env.ADMIN_EMAIL ?? "(non configurato)";

  for (const item of items) {
    try {
      const milestone = getReminderMilestone(
        {
          endDate: item.endDate,
          billingPeriod: item.billingPeriod,
          customPeriodDays: item.customPeriodDays,
        },
        settings,
      );
      if (!milestone) continue;

      const diffDays = Math.ceil(
        (item.endDate.getTime() - now.getTime()) / MS_PER_DAY,
      );
      const client = item.subscription.client;
      const clientName = client.ragioneSociale?.trim()
        ? client.ragioneSociale
        : client.name;
      const emailData = {
        subscriptionId: item.subscriptionId,
        clientName,
        serviceName: item.service.name,
        endDate: item.endDate,
        diffDays,
      };

      // Due invii INDIPENDENTI (admin + cliente), ciascuno con dedupeKey distinto
      // per non collidere sul vincolo unique [subscriptionItemId, type, dedupeKey].
      const adminKey = `${dedupeKey}-admin`;
      const clientKey = `${dedupeKey}-client`;

      // ── Invio ADMIN (invariato nel contenuto) ────────────────────────────
      const adminExisting = await prisma.notificationLog.findFirst({
        where: {
          subscriptionItemId: item.id,
          type: milestone.type,
          dedupeKey: adminKey,
        },
        select: { id: true },
      });
      if (adminExisting) {
        remindersSkipped++;
      } else {
        const adminContent = buildReminderEmail(milestone.type, emailData, {
          override: templates[milestone.type],
          audience: "admin",
        });
        const sent = await sendEmail(adminContent); // → ADMIN_EMAIL
        await prisma.notificationLog.create({
          data: {
            subscriptionItemId: item.id,
            type: milestone.type,
            status: sent.status,
            recipient: adminRecipient,
            resendId: sent.resendId,
            error: sent.error,
            dedupeKey: adminKey,
          },
        });
        if (sent.status === "INVIATA") remindersSent++;
        else remindersFailed++;
      }

      // ── Invio CLIENTE (tono diretto, nessun link admin) ──────────────────
      const clientExisting = await prisma.notificationLog.findFirst({
        where: {
          subscriptionItemId: item.id,
          type: milestone.type,
          dedupeKey: clientKey,
        },
        select: { id: true },
      });
      if (clientExisting) {
        remindersSkipped++;
      } else if (!client.email) {
        // Email cliente assente: salta SOLO l'invio cliente, loggandolo come
        // FALLITA (non blocca l'invio admin, già gestito sopra).
        await prisma.notificationLog.create({
          data: {
            subscriptionItemId: item.id,
            type: milestone.type,
            status: "FALLITA",
            recipient: "(cliente senza email)",
            error: "Cliente senza indirizzo email",
            dedupeKey: clientKey,
          },
        });
        remindersFailed++;
      } else {
        // Sezione rinnovo (coordinate bancarie + disclaimer + eventuale CTA):
        // solo per item SENZA rinnovo automatico. Caso A (promemoria/sollecito):
        // genera/riusa una AutoChargeRequest per la CTA. Caso B (cessazione):
        // solo coordinate + disclaimer, nessuna CTA.
        let clientRenewal:
          | { amountCents: number; currency: string; autoChargeUrl?: string | null }
          | undefined;
        if (!item.autoChargeEnabled) {
          // Il prezzo è NETTO: il totale del bonifico è il LORDO (netto + 22%).
          const amountCents = addVatToNet(
            item.priceCents * item.quantity,
          ).grossCents;
          if (milestone.type === "CESSAZIONE_MOROSITA") {
            clientRenewal = { amountCents, currency: item.currency };
          } else {
            let autoChargeUrl: string | null = null;
            const appUrl = process.env.APP_URL;
            if (appUrl) {
              const token = await ensureAutoChargeRequestToken(
                client.id,
                item.id,
              );
              autoChargeUrl = `${appUrl}/attiva-rinnovo/${token}`;
            }
            clientRenewal = { amountCents, currency: item.currency, autoChargeUrl };
          }
        }
        const clientContent = buildReminderEmail(milestone.type, emailData, {
          audience: "client",
          clientRenewal,
        });
        const sent = await sendEmail(clientContent, client.email);
        await prisma.notificationLog.create({
          data: {
            subscriptionItemId: item.id,
            type: milestone.type,
            status: sent.status,
            recipient: client.email,
            resendId: sent.resendId,
            error: sent.error,
            dedupeKey: clientKey,
          },
        });
        if (sent.status === "INVIATA") remindersSent++;
        else remindersFailed++;
      }

      // ── Cessazione per morosità (una volta, indipendente dagli invii) ─────
      // Un eventuale fallimento email NON impedisce la cessazione. Guardata dallo
      // stato, è idempotente su run ripetuti.
      if (milestone.isCessationTrigger) {
        const res = await prisma.subscriptionItem.updateMany({
          where: { id: item.id, status: { notIn: [...BLOCKING] } },
          data: { status: "CESSATO" },
        });
        if (res.count > 0) cessations++;
      }
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
