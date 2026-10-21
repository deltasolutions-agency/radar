import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getReminderMilestone,
  type ReminderMilestone,
} from "@/lib/reminder-schedule";
import type { ReminderThresholds } from "@/lib/reminder-settings";

// Logica di SELEZIONE del cron reminder, condivisa tra la route
// /api/cron/reminders e lo script di sola lettura scripts/cron-preview.ts.
// Nessuna funzione qui scrive su DB, invia email o chiama Stripe.

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Stati manuali bloccanti: mai toccati dal cron.
export const BLOCKING = ["CESSATO", "SOSPESO"] as const;

// Item con relazioni caricate nel loop dei reminder.
export type ReminderItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

/** Chiave-giorno locale (YYYY-MM-DD) usata come dedupeKey dei NotificationLog. */
export function reminderDayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Giorni mancanti alla scadenza (Math.ceil, come computeItemStatus). */
export function reminderDiffDays(item: { endDate: Date }, now: Date): number {
  return Math.ceil((item.endDate.getTime() - now.getTime()) / MS_PER_DAY);
}

/** Righe candidate ai reminder: tutte quelle non in stato bloccante. */
export function loadReminderItems(): Promise<ReminderItem[]> {
  return prisma.subscriptionItem.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    include: {
      service: true,
      subscription: { include: { client: true } },
    },
  });
}

export type ReminderAction =
  // Rinnovo automatico attivo e scadenza a 7 giorni ESATTI: solo preavviso
  // addebito al cliente (sostituisce l'avviso generico di quel giorno).
  | { kind: "PREAVVISO_ADDEBITO"; diffDays: number }
  // Milestone di reminder (admin + cliente), eventualmente con cessazione.
  | { kind: "MILESTONE"; diffDays: number; milestone: ReminderMilestone }
  | null;

/** Cosa farebbe oggi il cron reminder per questa riga (null = niente). */
export function selectReminderAction(
  item: ReminderItem,
  now: Date,
  settings: ReminderThresholds,
): ReminderAction {
  const diffDays = reminderDiffDays(item, now);
  if (item.autoChargeEnabled && diffDays === 7) {
    return { kind: "PREAVVISO_ADDEBITO", diffDays };
  }
  const milestone = getReminderMilestone(
    {
      endDate: item.endDate,
      billingPeriod: item.billingPeriod,
      customPeriodDays: item.customPeriodDays,
    },
    settings,
    now,
  );
  if (!milestone) return null;
  return { kind: "MILESTONE", diffDays, milestone };
}

/** true se esiste già un NotificationLog per (riga, tipo, dedupeKey). */
export async function hasNotificationLog(
  subscriptionItemId: string,
  type: NotificationType,
  dedupeKey: string,
): Promise<boolean> {
  const existing = await prisma.notificationLog.findFirst({
    where: { subscriptionItemId, type, dedupeKey },
    select: { id: true },
  });
  return existing != null;
}

/**
 * payToken di un Payment Stripe IN_ATTESA, non scaduto, che copre la riga: il
 * reminder lo riusa come CTA invece di creare una nuova Checkout Session.
 */
export async function findReusablePaymentToken(
  subscriptionItemId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const existing = await prisma.payment.findFirst({
    where: {
      status: "IN_ATTESA",
      method: "STRIPE",
      checkoutExpiresAt: { gt: now },
      items: { some: { subscriptionItemId, status: "IN_ATTESA" } },
    },
    orderBy: { createdAt: "desc" },
    select: { payToken: true },
  });
  return existing?.payToken ?? null;
}

/** Token di una AutoChargeRequest pendente (non usata) che copre la riga. */
export async function findPendingAutoChargeRequestToken(
  clientId: string,
  itemId: string,
): Promise<string | null> {
  const existing = await prisma.autoChargeRequest.findFirst({
    where: { clientId, usedAt: null, itemIds: { has: itemId } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  return existing?.token ?? null;
}

/** Nome cliente mostrato nelle email: ragione sociale se presente. */
export function clientDisplayName(client: {
  ragioneSociale: string | null;
  name: string;
}): string {
  return client.ragioneSociale?.trim() ? client.ragioneSociale : client.name;
}
