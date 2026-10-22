import { prisma } from "@/lib/prisma";
import { romeYmd } from "@/lib/rome-time";
import { loadFirstPaymentSettings, type FirstPaymentSettings } from "@/lib/reminder-settings";
import { clientDisplayName } from "@/lib/cron/common";
import { REMINDER_RECOVERY_DAYS } from "@/lib/cron/reminders-plan";

// Solleciti del PRIMO pagamento (abbonamenti "da pagare" ancora in attesa),
// eseguiti dal cron reminder: email al cliente ai giorni configurati dall'invio
// del link (default +3, +7) e avviso all'admin (default +10). Nessuna
// cessazione automatica. Calcolo di sola lettura (cron, dry-run, anteprima).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PendingFirstPayment = {
  subscriptionId: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  /** null = nessun link valido (mai inviato, invalidato o stornato). */
  linkSentAt: Date | null;
  /** Giorni di calendario (ora italiana) dall'invio del link. */
  daysSinceLink: number | null;
  /** Token /pay del pagamento di attivazione ancora pagabile. */
  payToken: string | null;
  currency: string;
  netCents: number;
  items: {
    id: string;
    serviceName: string;
    endClientName: string | null;
    netCents: number;
    startDate: Date;
    endDate: Date;
  }[];
};

export type FirstPaymentAction = {
  kind: "CLIENT_REMINDER" | "ADMIN_ALERT";
  /** Giorno della soglia (es. 3, 7, 10). */
  day: number;
  sub: PendingFirstPayment;
  dedupeKey: string;
  /** Motivo per cui non partirebbe (cliente senza email / nessun link). */
  blocked?: "NO_EMAIL" | "NO_LINK";
};

export type FirstPaymentPlan = {
  settings: FirstPaymentSettings;
  pending: PendingFirstPayment[];
  actions: FirstPaymentAction[];
  /** Soglie già gestite (email già inviata). */
  alreadySent: number;
};

function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${romeYmd(from)}T00:00:00Z`);
  const b = Date.parse(`${romeYmd(to)}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

export function firstPaymentDedupeKey(
  kind: FirstPaymentAction["kind"],
  subscriptionId: string,
  linkSentAt: Date,
  day: number,
): string {
  return kind === "ADMIN_ALERT"
    ? `first-payment-admin:${subscriptionId}:${linkSentAt.getTime()}`
    : `first-payment-reminder:${subscriptionId}:${linkSentAt.getTime()}:${day}`;
}

async function alreadySent(dedupeKey: string): Promise<boolean> {
  const row = await prisma.emailLog.findFirst({
    where: { dedupeKey, status: "SENT" },
    select: { id: true },
  });
  return !!row;
}

/** Calcola gli abbonamenti in attesa e i solleciti dovuti adesso. Nessuna scrittura. */
export async function planFirstPaymentReminders(now: Date): Promise<FirstPaymentPlan> {
  const settings = await loadFirstPaymentSettings();
  const subs = await prisma.subscription.findMany({
    where: { activationState: "PENDING_FIRST_PAYMENT" },
    include: {
      client: true,
      items: {
        where: { status: { not: "CESSATO" } },
        include: { service: true },
        orderBy: { endDate: "asc" },
      },
      payments: {
        where: {
          kind: "ACTIVATION",
          method: "STRIPE",
          OR: [{ status: "IN_ATTESA" }, { status: "FALLITO", note: null }],
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { payToken: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const pending: PendingFirstPayment[] = subs.map((s) => {
    const items = s.items.map((it) => ({
      id: it.id,
      serviceName: it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
      endClientName: it.endClientName,
      netCents: it.priceCents * it.quantity,
      startDate: it.startDate,
      endDate: it.endDate,
    }));
    return {
      subscriptionId: s.id,
      clientId: s.clientId,
      clientName: clientDisplayName(s.client),
      clientEmail: s.client.email?.trim() ? s.client.email : null,
      linkSentAt: s.firstPaymentLinkSentAt,
      daysSinceLink: s.firstPaymentLinkSentAt ? calendarDaysBetween(s.firstPaymentLinkSentAt, now) : null,
      payToken: s.payments[0]?.payToken ?? null,
      currency: s.items[0]?.currency ?? "eur",
      netCents: items.reduce((sum, it) => sum + it.netCents, 0),
      items,
    };
  });

  const actions: FirstPaymentAction[] = [];
  let sentCount = 0;
  for (const sub of pending) {
    if (!sub.linkSentAt || sub.daysSinceLink == null || sub.items.length === 0) continue;
    const days = sub.daysSinceLink;

    // Cliente: solo la soglia più recente raggiunta, entro la finestra di recupero.
    const mark = [...settings.reminderDays].reverse().find((d) => d <= days);
    if (mark != null && days - mark <= REMINDER_RECOVERY_DAYS) {
      const dedupeKey = firstPaymentDedupeKey("CLIENT_REMINDER", sub.subscriptionId, sub.linkSentAt, mark);
      if (await alreadySent(dedupeKey)) sentCount++;
      else {
        actions.push({
          kind: "CLIENT_REMINDER",
          day: mark,
          sub,
          dedupeKey,
          ...(!sub.clientEmail ? { blocked: "NO_EMAIL" as const } : !sub.payToken ? { blocked: "NO_LINK" as const } : {}),
        });
      }
    }

    // Admin: una sola volta per link, da adminAlertDay in poi.
    if (days >= settings.adminAlertDay) {
      const dedupeKey = firstPaymentDedupeKey("ADMIN_ALERT", sub.subscriptionId, sub.linkSentAt, settings.adminAlertDay);
      if (await alreadySent(dedupeKey)) sentCount++;
      else actions.push({ kind: "ADMIN_ALERT", day: settings.adminAlertDay, sub, dedupeKey });
    }
  }

  return { settings, pending, actions, alreadySent: sentCount };
}

export function firstPaymentActionLabel(a: FirstPaymentAction): string {
  return a.kind === "ADMIN_ALERT"
    ? `Avviso admin primo pagamento (+${a.day} gg)`
    : `Sollecito primo pagamento (+${a.day} gg)`;
}
