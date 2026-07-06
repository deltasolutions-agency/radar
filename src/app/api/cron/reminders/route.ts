import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { getReminderMilestone } from "@/lib/reminder-schedule";
import { buildReminderEmail } from "@/lib/email-templates";
import { createCheckoutPayment } from "@/lib/payment-checkout";
import { sendEmail } from "@/lib/send-email";
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

// Item con relazioni caricate nel loop dei reminder.
type ReminderItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

/**
 * Restituisce il payToken di un link di pagamento Stripe per questo item:
 * riusa un Payment IN_ATTESA (Stripe, non scaduto) che copre l'item, altrimenti
 * ne crea uno nuovo (solo quell'item) tramite createCheckoutPayment SENZA inviare
 * email (il link viene messo come CTA nel reminder). null se la generazione
 * fallisce (non deve bloccare l'invio del reminder).
 */
async function ensurePaymentLinkToken(
  item: ReminderItem,
  appUrl: string,
): Promise<string | null> {
  const existing = await prisma.payment.findFirst({
    where: {
      status: "IN_ATTESA",
      method: "STRIPE",
      checkoutExpiresAt: { gt: new Date() },
      items: { some: { subscriptionItemId: item.id, status: "IN_ATTESA" } },
    },
    orderBy: { createdAt: "desc" },
    select: { payToken: true },
  });
  if (existing) return existing.payToken;

  try {
    const result = await createCheckoutPayment(
      {
        subscriptionId: item.subscriptionId,
        clientEmail: item.subscription.client.email,
        serviceFeeEnabled: item.subscription.serviceFeeEnabled,
        items: [
          {
            id: item.id,
            currency: item.currency,
            priceCents: item.priceCents,
            quantity: item.quantity,
            endDate: item.endDate,
            billingPeriod: item.billingPeriod,
            customPeriodDays: item.customPeriodDays,
            service: {
              name: item.service.name,
              description: item.service.description,
            },
          },
        ],
      },
      appUrl,
      { sendToClient: false },
    );
    return result.payment.payToken;
  } catch (e) {
    console.error(
      `[cron reminders] creazione link pagamento fallita (item ${item.id}):`,
      e,
    );
    return null;
  }
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
          | {
              netCents: number;
              currency: string;
              autoChargeUrl?: string | null;
              payUrl?: string | null;
            }
          | undefined;
        if (!item.autoChargeEnabled) {
          // Il prezzo è NETTO: l'email mostra imponibile/IVA/totale a partire da qui.
          const netCents = item.priceCents * item.quantity;
          const appUrl = process.env.APP_URL;

          // Link di pagamento elettronico (CTA "Paga online con carta"), sia per
          // il Caso A sia per il Caso B (alternativa al bonifico).
          let payUrl: string | null = null;
          if (appUrl) {
            const payToken = await ensurePaymentLinkToken(item, appUrl);
            if (payToken) payUrl = `${appUrl}/pay/${payToken}`;
          }

          if (milestone.type === "CESSAZIONE_MOROSITA") {
            clientRenewal = { netCents, currency: item.currency, payUrl };
          } else {
            let autoChargeUrl: string | null = null;
            if (appUrl) {
              const token = await ensureAutoChargeRequestToken(
                client.id,
                item.id,
              );
              autoChargeUrl = `${appUrl}/attiva-rinnovo/${token}`;
            }
            clientRenewal = {
              netCents,
              currency: item.currency,
              autoChargeUrl,
              payUrl,
            };
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
