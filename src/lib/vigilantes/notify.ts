import "server-only";
import type { EmailTrigger, WpSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCronSummaryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import {
  ALERT_KIND_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  VIGILANTES_ALERT_RECIPIENT,
  type AlertKindValue,
  type AlertSeverityValue,
} from "@/lib/vigilantes/meta";

// Vigilantes — invio delle email: hello@ riceve sempre tutto (con il link a
// Radar); i destinatari aggiuntivi di un sito ricevono solo quel sito, senza
// link alla dashboard, secondo la loro modalità (ALL / CRITICAL / DIGEST).

type AlertLite = { id: string; kind: string; severity: string; title: string; openedAt: Date };

const kindLabel = (k: string) => ALERT_KIND_LABELS[k as AlertKindValue] ?? k;

function criticalEmail(site: WpSite, alerts: AlertLite[], internal: boolean) {
  const appUrl = process.env.APP_URL ?? "";
  return buildCronSummaryEmail({
    subject: `${internal ? "[Radar] " : ""}Allarme sicurezza: ${site.name} — ${alerts.map((a) => kindLabel(a.kind)).join(", ")}`,
    title: `Allarme su ${site.name}`,
    intro: internal
      ? `Vigilantes ha rilevato ${alerts.length === 1 ? "un problema critico" : `${alerts.length} problemi critici`} su ${site.url}. Controlla il sito il prima possibile.`
      : `Il monitoraggio Delta Solutions ha rilevato ${alerts.length === 1 ? "un problema critico" : `${alerts.length} problemi critici`} su ${site.url}. Il nostro team è stato avvisato e lo sta verificando.`,
    sections: [
      { heading: "Cosa è successo", lines: alerts.map((a) => a.title) },
      ...(internal ? [{ heading: "Apri in Radar", lines: [`${appUrl}/vigilantes/${site.id}`] }] : []),
    ],
  });
}

/** Email immediata per gli alert CRITICAL appena aperti: hello@ + destinatari del sito. */
export async function notifyCritical(site: WpSite, opened: AlertLite[], trigger: EmailTrigger) {
  const critical = opened.filter((a) => a.severity === "CRITICAL");
  if (critical.length === 0) return;
  const key = critical
    .map((a) => `${a.id}@${a.openedAt.getTime()}`)
    .sort()
    .join(",");

  const res = await sendEmail(criticalEmail(site, critical, true), VIGILANTES_ALERT_RECIPIENT, {
    type: "WP_MONITOR_ALERT",
    trigger,
    clientId: site.clientId,
    dedupeKey: `vigilantes-alert:${site.id}:${key}`,
  }).catch((e) => {
    console.error("[vigilantes] invio allarme fallito:", e);
    return null;
  });

  const recipients = await prisma.wpAlertRecipient.findMany({
    where: { siteId: site.id, mode: { in: ["ALL", "CRITICAL"] } },
  });
  for (const r of recipients) {
    await sendEmail(criticalEmail(site, critical, false), r.email, {
      type: "WP_MONITOR_ALERT",
      trigger,
      clientId: site.clientId,
      dedupeKey: `vigilantes-alert:${site.id}:${r.email}:${key}`,
    }).catch((e) => console.error(`[vigilantes] invio allarme a ${r.email} fallito:`, e));
  }

  if (res?.ok) {
    await prisma.wpAlert.updateMany({
      where: { id: { in: critical.map((a) => a.id) } },
      data: { notifiedAt: new Date() },
    });
  }
}

/**
 * Riepilogo giornaliero per sito ai destinatari aggiuntivi (ALL / DIGEST):
 * solo gli alert aperti e non segnati come visti di quel sito.
 * Restituisce quante email sono partite e quante sono fallite.
 */
export async function sendSiteDigests(todayYmd: string): Promise<{ sent: number; failed: number; details: Record<string, unknown>[] }> {
  const recipients = await prisma.wpAlertRecipient.findMany({
    where: { mode: { in: ["ALL", "DIGEST"] }, site: { enabled: true } },
    include: { site: true },
  });
  const bySite = new Map<string, typeof recipients>();
  for (const r of recipients) bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r]);

  let sent = 0;
  let failed = 0;
  const details: Record<string, unknown>[] = [];
  for (const [siteId, list] of bySite) {
    const site = list[0].site;
    const alerts = await prisma.wpAlert.findMany({
      where: { siteId, resolvedAt: null, acknowledgedAt: null },
      orderBy: { openedAt: "asc" },
    });
    if (alerts.length === 0) continue;
    alerts.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity as AlertSeverityValue] - SEVERITY_RANK[a.severity as AlertSeverityValue],
    );
    const updates = alerts.filter((a) => a.kind.endsWith("_UPDATE")).length;
    const security = alerts.length - updates;
    const content = buildCronSummaryEmail({
      subject: `Stato del sito ${site.name}: ${[security ? `${security} da verificare` : "", updates ? `${updates} aggiornamenti` : ""].filter(Boolean).join(", ")}`,
      title: `Monitoraggio di ${site.name}`,
      intro: `Riepilogo giornaliero del monitoraggio Delta Solutions per ${site.url}. Gli aggiornamenti vengono gestiti dal nostro team; le segnalazioni di sicurezza sono in verifica.`,
      sections: [
        {
          heading: "Situazione",
          lines: alerts.map((a) => `[${SEVERITY_LABELS[a.severity as AlertSeverityValue]}] ${a.title}`),
        },
      ],
    });
    for (const r of list) {
      const res = await sendEmail(content, r.email, {
        type: "WP_MONITOR_DIGEST",
        trigger: "CRON",
        clientId: site.clientId,
        dedupeKey: `vigilantes-site-digest:${siteId}:${r.email}:${todayYmd}`,
      }).catch(() => null);
      if (res?.ok && !res.skipped) sent++;
      else if (!res?.ok) failed++;
      details.push({
        outcome: !res ? "FAILED" : res.ok ? (res.skipped ? "SKIPPED" : "SENT") : "FAILED",
        client: `Riepilogo ${site.name}`,
        services: `${alerts.length} alert`,
        recipient: r.email,
        error: res && !res.ok ? res.error : undefined,
      });
    }
  }
  return { sent, failed, details };
}

/** Email di prova a hello@ e a tutti i destinatari del sito. */
export async function sendTestEmail(site: WpSite): Promise<{ to: string; ok: boolean; error?: string }[]> {
  const recipients = await prisma.wpAlertRecipient.findMany({ where: { siteId: site.id } });
  const content = buildCronSummaryEmail({
    subject: `Email di prova — monitoraggio ${site.name}`,
    title: `Email di prova per ${site.name}`,
    intro: `Questo indirizzo riceverà le notifiche del monitoraggio Delta Solutions per ${site.url}. Non è richiesta nessuna azione.`,
    sections: [],
  });
  const out: { to: string; ok: boolean; error?: string }[] = [];
  for (const to of [VIGILANTES_ALERT_RECIPIENT, ...recipients.map((r) => r.email)]) {
    const res = await sendEmail(content, to, {
      type: "WP_MONITOR_ALERT",
      trigger: "MANUAL",
      clientId: site.clientId,
    }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as const);
    out.push({ to, ok: res.ok, error: res.ok ? undefined : (res as { error?: string }).error });
  }
  return out;
}
