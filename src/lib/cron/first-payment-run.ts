import "server-only";
import {
  buildFirstPaymentAdminAlertEmail,
  buildFirstPaymentReminderEmail,
} from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { prisma } from "@/lib/prisma";
import { langOf, localizedServiceName, type Lang } from "@/lib/i18n";
import {
  firstPaymentActionLabel,
  type FirstPaymentAction,
  type FirstPaymentPlan,
} from "@/lib/cron/first-payment-plan";

export function firstPaymentDetail(a: FirstPaymentAction, extra: Record<string, unknown> = {}) {
  return {
    subscriptionId: a.sub.subscriptionId,
    client: a.sub.clientName,
    recipient: a.kind === "ADMIN_ALERT" ? "admin" : a.sub.clientEmail,
    note: firstPaymentActionLabel(a),
    milestone: a.kind === "ADMIN_ALERT" ? "FIRST_PAYMENT_ADMIN_ALERT" : "FIRST_PAYMENT_REMINDER",
    daysSinceLink: a.sub.daysSinceLink,
    netCents: a.sub.netCents,
    ...extra,
  };
}

export type FirstPaymentRunResult = {
  sent: number;
  failed: number;
  skipped: number;
  details: Record<string, unknown>[];
  summarySent: string[];
  summaryErrors: string[];
};

/**
 * Lingua del cliente e nomi dei servizi localizzati per le righe del sollecito.
 * Il piano espone i nomi in italiano: qui si ricaricano locale e nameEn.
 */
async function clientLocalization(
  clientId: string,
  itemIds: string[],
): Promise<{ lang: Lang; names: Map<string, string> }> {
  const [client, rows] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { locale: true } }),
    prisma.subscriptionItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, quantity: true, service: { select: { name: true, nameEn: true } } },
    }),
  ]);
  const lang = langOf(client?.locale);
  const names = new Map(
    rows.map((r) => {
      const name = localizedServiceName(r.service, lang);
      return [r.id, r.quantity > 1 ? `${name} ×${r.quantity}` : name] as const;
    }),
  );
  return { lang, names };
}

/** Invia i solleciti di primo pagamento dovuti (idempotente sul dedupeKey). */
export async function runFirstPaymentActions(plan: FirstPaymentPlan): Promise<FirstPaymentRunResult> {
  const out: FirstPaymentRunResult = {
    sent: 0,
    failed: 0,
    skipped: plan.alreadySent,
    details: [],
    summarySent: [],
    summaryErrors: [],
  };
  const appUrl = process.env.APP_URL ?? "";

  for (const a of plan.actions) {
    const line = `${a.sub.clientName} · ${firstPaymentActionLabel(a)}`;
    try {
      if (a.blocked) {
        const reason = a.blocked === "NO_EMAIL" ? "cliente senza email" : "nessun link di pagamento valido (reinvia il link)";
        out.failed++;
        out.summaryErrors.push(`${line} → ${reason}`);
        out.details.push(firstPaymentDetail(a, { outcome: a.blocked, error: reason }));
        continue;
      }
      const items = a.sub.items.map((it) => ({
        serviceName: it.serviceName,
        endClientName: it.endClientName,
        netCents: it.netCents,
        startDate: it.startDate,
        endDate: it.endDate,
      }));
      // Sollecito al cliente: nella sua lingua (l'avviso admin resta in italiano).
      const loc =
        a.kind === "ADMIN_ALERT"
          ? null
          : await clientLocalization(a.sub.clientId, a.sub.items.map((it) => it.id));
      const clientItems = loc
        ? items.map((it, i) => ({
            ...it,
            serviceName: loc.names.get(a.sub.items[i].id) ?? it.serviceName,
          }))
        : items;
      const res =
        a.kind === "ADMIN_ALERT"
          ? await sendEmail(
              buildFirstPaymentAdminAlertEmail({
                subscriptionId: a.sub.subscriptionId,
                clientName: a.sub.clientName,
                clientEmail: a.sub.clientEmail,
                daysSinceLink: a.sub.daysSinceLink ?? a.day,
                linkSentAt: a.sub.linkSentAt!,
                items,
                currency: a.sub.currency,
              }),
              undefined,
              {
                type: "FIRST_PAYMENT_ADMIN_ALERT",
                trigger: "CRON",
                clientId: a.sub.clientId,
                subscriptionId: a.sub.subscriptionId,
                itemIds: a.sub.items.map((it) => it.id),
                dedupeKey: a.dedupeKey,
              },
            )
          : await sendEmail(
              buildFirstPaymentReminderEmail({
                clientName: a.sub.clientName,
                items: clientItems,
                lang: loc?.lang ?? "it",
                currency: a.sub.currency,
                daysSinceLink: a.sub.daysSinceLink ?? a.day,
                payment: {
                  payUrl: `${appUrl}/pay/${a.sub.payToken}`,
                  netCents: a.sub.netCents,
                  currency: a.sub.currency,
                },
              }),
              a.sub.clientEmail!,
              {
                type: "FIRST_PAYMENT_REMINDER",
                trigger: "CRON",
                clientId: a.sub.clientId,
                subscriptionId: a.sub.subscriptionId,
                itemIds: a.sub.items.map((it) => it.id),
                dedupeKey: a.dedupeKey,
              },
            );
      if (res.skipped) {
        out.skipped++;
        out.details.push(firstPaymentDetail(a, { outcome: "SKIPPED", emailLogId: res.logId }));
      } else if (res.ok) {
        out.sent++;
        out.summarySent.push(`${line} → ${a.kind === "ADMIN_ALERT" ? "admin" : a.sub.clientEmail}`);
        out.details.push(firstPaymentDetail(a, { outcome: "SENT", emailLogId: res.logId }));
      } else {
        out.failed++;
        out.summaryErrors.push(`${line}: ${res.error ?? "errore"}`);
        out.details.push(firstPaymentDetail(a, { outcome: "FAILED", error: res.error, emailLogId: res.logId }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron reminders] sollecito primo pagamento fallito (sub ${a.sub.subscriptionId}):`, e);
      out.failed++;
      out.summaryErrors.push(`${line}: ${msg}`);
      out.details.push(firstPaymentDetail(a, { outcome: "ERROR", error: msg }));
    }
  }
  return out;
}
