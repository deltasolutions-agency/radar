import "server-only";
import type { EmailTrigger, Prisma, WpSite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCronSummaryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import {
  analyzeReport,
  adminLoginsFromStored,
  isReportManagedKey,
  PULL_KEYS,
  type DesiredAlert,
} from "@/lib/vigilantes/analyze";
import { ALERT_KIND_LABELS, VIGILANTES_ALERT_RECIPIENT } from "@/lib/vigilantes/meta";
import type { VigilantesReport } from "@/lib/vigilantes/protocol";

type Tx = Prisma.TransactionClient;
type OpenedAlert = { id: string; severity: string; title: string; kind: string; openedAt: Date };

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/**
 * Applica gli alert desiderati: crea, aggiorna o riapre quelli presenti;
 * chiude quelli aperti con chiave in `manages` che non compaiono più.
 * Restituisce gli alert appena aperti (o riaperti).
 */
export async function syncAlerts(
  tx: Tx,
  siteId: string,
  desired: DesiredAlert[],
  manages: (key: string) => boolean,
  now: Date,
): Promise<OpenedAlert[]> {
  const existing = await tx.wpAlert.findMany({ where: { siteId } });
  const byKey = new Map(existing.map((a) => [a.key, a]));
  const desiredKeys = new Set(desired.map((d) => d.key));
  const opened: OpenedAlert[] = [];

  for (const d of desired) {
    const cur = byKey.get(d.key);
    if (!cur) {
      const a = await tx.wpAlert.create({
        data: {
          siteId,
          kind: d.kind,
          severity: d.severity,
          key: d.key,
          title: d.title,
          details: toJson(d.details),
          openedAt: now,
          lastSeenAt: now,
        },
      });
      opened.push(a);
    } else if (cur.resolvedAt) {
      const a = await tx.wpAlert.update({
        where: { id: cur.id },
        data: {
          kind: d.kind,
          severity: d.severity,
          title: d.title,
          details: toJson(d.details),
          openedAt: now,
          lastSeenAt: now,
          resolvedAt: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          notifiedAt: null,
        },
      });
      opened.push(a);
    } else {
      const changed = cur.title !== d.title;
      await tx.wpAlert.update({
        where: { id: cur.id },
        data: {
          kind: d.kind,
          severity: d.severity,
          title: d.title,
          details: toJson(d.details),
          lastSeenAt: now,
          // Situazione cambiata (es. nuova versione): torna nel riepilogo.
          ...(changed ? { acknowledgedAt: null, acknowledgedBy: null } : {}),
        },
      });
    }
  }

  const toResolve = existing.filter((a) => !a.resolvedAt && manages(a.key) && !desiredKeys.has(a.key));
  if (toResolve.length > 0) {
    await tx.wpAlert.updateMany({
      where: { id: { in: toResolve.map((a) => a.id) } },
      data: { resolvedAt: now },
    });
  }
  return opened;
}

/** Componenti del sito: sostituiti con quelli del report, mantenendo `updateSince`. */
async function syncComponents(
  tx: Tx,
  siteId: string,
  rows: ReturnType<typeof analyzeReport>["components"],
  now: Date,
) {
  const existing = await tx.wpComponent.findMany({ where: { siteId } });
  const key = (t: string, s: string) => `${t}:${s}`;
  const prev = new Map(existing.map((c) => [key(c.type, c.slug), c]));
  const seen = new Set<string>();

  for (const r of rows) {
    const k = key(r.type, r.slug);
    if (seen.has(k)) continue;
    seen.add(k);
    const old = prev.get(k);
    const updateSince = r.newVersion
      ? old?.newVersion === r.newVersion && old.updateSince
        ? old.updateSince
        : now
      : null;
    const data = {
      name: r.name.slice(0, 300),
      version: r.version,
      newVersion: r.newVersion,
      active: r.active,
      autoUpdate: r.autoUpdate,
      updateSince,
    };
    if (old) await tx.wpComponent.update({ where: { id: old.id }, data });
    else await tx.wpComponent.create({ data: { siteId, type: r.type, slug: r.slug, ...data } });
  }
  const gone = existing.filter((c) => !seen.has(key(c.type, c.slug)));
  if (gone.length > 0) await tx.wpComponent.deleteMany({ where: { id: { in: gone.map((c) => c.id) } } });
}

/** Report salvato in DB: tutto tranne gli elenchi già in WpComponent. */
function storedReport(report: VigilantesReport) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { plugins, themes, ...rest } = report;
  return rest;
}

export type IngestOutcome = { opened: OpenedAlert[]; updates: number };

/**
 * Registra un report (pull o push): versioni, componenti, alert. Gli alert
 * CRITICAL appena aperti partono subito per email.
 */
export async function ingestReport(
  site: WpSite,
  report: VigilantesReport,
  source: "PULL" | "PUSH",
  trigger: EmailTrigger,
  now: Date = new Date(),
  extraAlerts: DesiredAlert[] = [],
): Promise<IngestOutcome> {
  const analysis = analyzeReport(report, adminLoginsFromStored(site.report), { deepScan: site.deepScan });
  // Un alert esplicito (es. disinstallazione) sostituisce quello di disattivazione.
  const desired = extraAlerts.some((a) => a.key === "agent-removed")
    ? [...analysis.alerts.filter((a) => a.key !== "agent-deactivated"), ...extraAlerts]
    : [...analysis.alerts, ...extraAlerts];
  const opened = await prisma.$transaction(
    async (tx) => {
      await tx.wpSite.update({
        where: { id: site.id },
        data: {
          wpVersion: analysis.wpVersion.slice(0, 50),
          phpVersion: analysis.phpVersion?.slice(0, 50) ?? null,
          pluginVersion: analysis.pluginVersion.slice(0, 50),
          lastReportAt: now,
          lastReportSource: source,
          report: toJson(storedReport(report)),
        },
      });
      await syncComponents(tx, site.id, analysis.components, now);
      return syncAlerts(tx, site.id, desired, isReportManagedKey, now);
    },
    { timeout: 20_000 },
  );
  await notifyCritical(site, opened, trigger);
  return { opened, updates: analysis.alerts.filter((a) => a.kind.endsWith("_UPDATE")).length };
}

/** Esito di un controllo pull: aggiorna lo stato e apre/chiude gli alert di raggiungibilità. */
export async function recordCheckResult(
  site: WpSite,
  result:
    | { ok: true }
    | { ok: false; kind: "SITE_UNREACHABLE" | "AGENT_ERROR"; error: string; critical?: boolean },
  trigger: EmailTrigger,
  now: Date = new Date(),
): Promise<OpenedAlert[]> {
  const desired: DesiredAlert[] = result.ok
    ? []
    : [
        result.kind === "SITE_UNREACHABLE"
          ? {
              kind: "SITE_UNREACHABLE",
              severity: "CRITICAL",
              key: PULL_KEYS.unreachable,
              title: `Il sito non risponde: ${result.error}`,
              details: { error: result.error },
            }
          : {
              kind: "AGENT_ERROR",
              severity: result.critical ? "CRITICAL" : "WARNING",
              key: PULL_KEYS.agent,
              title: `Il sito risponde ma il plugin Radar Vigilantes no: ${result.error}`,
              details: { error: result.error },
            },
      ];
  const pullKeys = new Set<string>(Object.values(PULL_KEYS));
  const opened = await prisma.$transaction(async (tx) => {
    await tx.wpSite.update({
      where: { id: site.id },
      data: {
        lastCheckAt: now,
        lastCheckOk: result.ok,
        lastCheckError: result.ok ? null : result.error.slice(0, 1000),
        consecutiveFailures: result.ok ? 0 : { increment: 1 },
      },
    });
    return syncAlerts(tx, site.id, desired, (k) => pullKeys.has(k), now);
  });
  await notifyCritical(site, opened, trigger);
  return opened;
}

/** Email immediata per gli alert CRITICAL appena aperti (una per sito). */
export async function notifyCritical(site: WpSite, opened: OpenedAlert[], trigger: EmailTrigger) {
  const critical = opened.filter((a) => a.severity === "CRITICAL");
  if (critical.length === 0) return;
  const appUrl = process.env.APP_URL ?? "";
  const content = buildCronSummaryEmail({
    subject: `[Radar] Allarme Vigilantes: ${site.name} — ${critical.map((a) => ALERT_KIND_LABELS[a.kind as keyof typeof ALERT_KIND_LABELS] ?? a.kind).join(", ")}`,
    title: `Allarme su ${site.name}`,
    intro: `Vigilantes ha rilevato ${critical.length === 1 ? "un problema critico" : `${critical.length} problemi critici`} su ${site.url}. Controlla il sito il prima possibile.`,
    sections: [
      { heading: "Cosa è successo", lines: critical.map((a) => a.title) },
      { heading: "Apri in Radar", lines: [`${appUrl}/vigilantes/${site.id}`] },
    ],
  });
  const res = await sendEmail(content, VIGILANTES_ALERT_RECIPIENT, {
    type: "WP_MONITOR_ALERT",
    trigger,
    clientId: site.clientId,
    dedupeKey: `vigilantes-alert:${site.id}:${critical
      .map((a) => `${a.id}@${a.openedAt.getTime()}`)
      .sort()
      .join(",")}`,
  }).catch((e) => {
    console.error("[vigilantes] invio allarme fallito:", e);
    return null;
  });
  if (res?.ok) {
    await prisma.wpAlert.updateMany({
      where: { id: { in: critical.map((a) => a.id) } },
      data: { notifiedAt: new Date() },
    });
  }
}
