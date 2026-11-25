import "server-only";
import { prisma } from "@/lib/prisma";
import { buildCronSummaryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { romeYmd } from "@/lib/rome-time";
import type { CronResult } from "@/lib/cron/common";
import { checkSite } from "@/lib/vigilantes/pull";
import {
  SEVERITY_LABELS,
  SEVERITY_RANK,
  STALE_REPORT_HOURS,
  VIGILANTES_ALERT_RECIPIENT,
  type AlertSeverityValue,
} from "@/lib/vigilantes/meta";

// Cron "vigilantes" — controlla tutti i siti WordPress attivi (pull firmato
// al plugin), aggiorna componenti e alert, poi manda UN riepilogo giornaliero
// a hello@ con tutti gli alert aperti e non segnati come visti. Gli alert
// critici (sito giù, sicurezza) partono subito, durante il controllo.
// Dry-run: nessuna chiamata ai siti, nessuna scrittura, nessun invio.

const CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function runVigilantes({ now, dryRun }: { now: Date; dryRun: boolean }): Promise<CronResult> {
  const sites = await prisma.wpSite.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    include: { client: { select: { name: true, ragioneSociale: true } } },
  });

  if (dryRun) {
    const open = await prisma.wpAlert.groupBy({
      by: ["siteId"],
      where: { resolvedAt: null, acknowledgedAt: null, site: { enabled: true } },
      _count: true,
    });
    const openBySite = new Map(open.map((o) => [o.siteId, o._count]));
    return {
      dryRun,
      candidates: sites.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: sites.map((s) => ({
        outcome: "WOULD_CHECK",
        client: s.name,
        services: s.url,
        note: `${openBySite.get(s.id) ?? 0} alert aperti · ultimo report ${s.lastReportAt ? s.lastReportAt.toISOString().slice(0, 16).replace("T", " ") : "mai"}`,
      })),
    };
  }

  const results = await mapLimit(sites, CONCURRENCY, async (s) => {
    try {
      return { site: s, res: await checkSite(s, { retry: true, trigger: "CRON" }) };
    } catch (e) {
      console.error(`[vigilantes] controllo ${s.url} fallito:`, e);
      return {
        site: s,
        res: { ok: false as const, kind: "AGENT_ERROR" as const, error: e instanceof Error ? e.message : String(e) },
      };
    }
  });

  const details: Record<string, unknown>[] = results.map(({ site, res }) =>
    res.ok
      ? {
          outcome: "CHECKED",
          client: site.name,
          services: site.url,
          note: res.updates > 0 ? `${res.updates} aggiornamenti disponibili` : "tutto aggiornato",
        }
      : {
          outcome: res.kind === "SITE_UNREACHABLE" ? "UNREACHABLE" : "AGENT_ERROR",
          client: site.name,
          services: site.url,
          error: res.error,
        },
  );
  const failed = results.filter((r) => !r.res.ok).length;

  // ── Riepilogo giornaliero ────────────────────────────────────────────────
  const alerts = await prisma.wpAlert.findMany({
    where: { resolvedAt: null, acknowledgedAt: null, site: { enabled: true } },
    include: { site: { select: { id: true, name: true, url: true } } },
    orderBy: [{ openedAt: "asc" }],
  });
  const staleBefore = new Date(now.getTime() - STALE_REPORT_HOURS * 3_600_000);
  const silent = sites.filter((s) => s.lastReportAt && s.lastReportAt < staleBefore);

  if (alerts.length === 0 && silent.length === 0) {
    return { dryRun, candidates: sites.length, sent: 0, skipped: 0, failed, details };
  }

  const today = romeYmd(now);
  const appUrl = process.env.APP_URL ?? "";
  const bySite = new Map<string, typeof alerts>();
  for (const a of alerts) bySite.set(a.siteId, [...(bySite.get(a.siteId) ?? []), a]);
  const worst = (list: typeof alerts) =>
    Math.max(...list.map((a) => SEVERITY_RANK[a.severity as AlertSeverityValue]));
  const groups = [...bySite.values()].sort((a, b) => worst(b) - worst(a) || a[0].site.name.localeCompare(b[0].site.name));

  const critical = alerts.filter((a) => a.severity === "CRITICAL").length;
  const updates = alerts.filter((a) => a.kind.endsWith("_UPDATE")).length;
  const subjectParts = [
    critical ? `${critical} critici` : "",
    updates ? `${updates} aggiornamenti` : "",
    silent.length ? `${silent.length} siti silenziosi` : "",
  ].filter(Boolean);

  const content = buildCronSummaryEmail({
    subject: `[Radar] Vigilantes: ${subjectParts.join(", ")} su ${bySite.size || silent.length} siti`,
    title: "Vigilantes: stato dei siti WordPress",
    intro:
      "Elenco degli alert aperti sui siti monitorati. Gli aggiornamenti spariscono da soli quando li applichi; " +
      'puoi togliere un alert da questo riepilogo con "Segna come visto" in Radar.',
    sections: [
      ...groups.map((list) => ({
        heading: `${list[0].site.name} — ${list[0].site.url}`,
        lines: list.map((a) => `[${SEVERITY_LABELS[a.severity as AlertSeverityValue]}] ${a.title}`),
      })),
      {
        heading: `Nessun report da oltre ${STALE_REPORT_HOURS} ore`,
        lines: silent.map((s) => `${s.name} — ${s.url}`),
      },
      { heading: "Apri in Radar", lines: [`${appUrl}/vigilantes`] },
    ],
  });

  const res = await sendEmail(content, VIGILANTES_ALERT_RECIPIENT, {
    type: "WP_MONITOR_DIGEST",
    trigger: "CRON",
    dedupeKey: `vigilantes-digest:${today}`,
  });
  return {
    dryRun,
    candidates: sites.length,
    sent: res.ok && !res.skipped ? 1 : 0,
    skipped: res.skipped ? 1 : 0,
    failed: failed + (res.ok ? 0 : 1),
    details: [
      ...details,
      {
        outcome: res.ok ? (res.skipped ? "SKIPPED" : "SENT") : "FAILED",
        client: "Riepilogo giornaliero",
        services: `${alerts.length} alert`,
        recipient: VIGILANTES_ALERT_RECIPIENT,
        error: res.ok ? undefined : res.error,
      },
    ],
  };
}
