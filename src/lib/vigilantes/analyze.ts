// Vigilantes — analisi pura di un report: componenti da salvare e alert che
// la situazione del sito richiede. Nessun accesso al DB (testabile a parte).

import type { VigilantesReport } from "@/lib/vigilantes/protocol";
import type { AlertKindValue, AlertSeverityValue } from "@/lib/vigilantes/meta";

export type ComponentRow = {
  type: "CORE" | "PLUGIN" | "THEME";
  slug: string;
  name: string;
  version: string | null;
  newVersion: string | null;
  active: boolean;
  autoUpdate: boolean;
};

export type DesiredAlert = {
  kind: AlertKindValue;
  severity: AlertSeverityValue;
  key: string;
  title: string;
  details?: Record<string, unknown>;
};

/** Prefissi delle chiavi gestite dal report: si chiudono quando spariscono. */
export const REPORT_MANAGED_PREFIXES = [
  "update:",
  "debug",
  "integrity",
  "uploads-php",
  "plugin-integrity",
  "malware",
  "agent-deactivated",
  "agent-removed",
];
/** Chiavi gestite dal controllo pull. */
export const PULL_KEYS = { unreachable: "unreachable", agent: "agent" } as const;

export function isReportManagedKey(key: string): boolean {
  return REPORT_MANAGED_PREFIXES.some((p) => key === p || key.startsWith(p));
}

const MAX_LIST = 20;

function clip(list: string[] | undefined): { list: string[]; total: number } {
  const all = list ?? [];
  return { list: all.slice(0, MAX_LIST), total: all.length };
}

export type Analysis = {
  components: ComponentRow[];
  alerts: DesiredAlert[];
  adminLogins: string[];
  wpVersion: string;
  phpVersion: string | null;
  pluginVersion: string;
};

/**
 * @param previousAdminLogins amministratori del report precedente; null se è
 *   il primo report (fa da riferimento: nessun alert "nuovo admin").
 */
export function analyzeReport(
  report: VigilantesReport,
  previousAdminLogins: string[] | null,
  opts: { deepScan: boolean } = { deepScan: true },
): Analysis {
  const components: ComponentRow[] = [];
  const alerts: DesiredAlert[] = [];

  // Core
  const coreNew = report.core.update?.version ?? null;
  components.push({
    type: "CORE",
    slug: "wordpress",
    name: "WordPress",
    version: report.core.version,
    newVersion: coreNew,
    active: true,
    autoUpdate: false,
  });
  if (coreNew) {
    alerts.push({
      kind: "CORE_UPDATE",
      severity: "WARNING",
      key: "update:CORE:wordpress",
      title: `WordPress ${report.core.version} → ${coreNew}`,
      details: { from: report.core.version, to: coreNew },
    });
  }

  // Plugin
  for (const p of report.plugins) {
    const nv = p.update?.version ?? null;
    const active = !!(p.active || p.network_active);
    components.push({
      type: "PLUGIN",
      slug: p.slug,
      name: p.name || p.slug,
      version: p.version ?? null,
      newVersion: nv,
      active,
      autoUpdate: !!p.auto_update,
    });
    if (nv) {
      alerts.push({
        kind: "PLUGIN_UPDATE",
        // Anche un plugin disattivato resta sul server ed è attaccabile.
        severity: "WARNING",
        key: `update:PLUGIN:${p.slug}`,
        title: `${p.name || p.slug} ${p.version ?? "?"} → ${nv}${active ? "" : " (disattivato)"}`,
        details: { slug: p.slug, from: p.version ?? null, to: nv, active },
      });
    }
  }

  // Temi
  for (const t of report.themes) {
    const nv = t.update?.version ?? null;
    components.push({
      type: "THEME",
      slug: t.slug,
      name: t.name || t.slug,
      version: t.version ?? null,
      newVersion: nv,
      active: !!t.active,
      autoUpdate: !!t.auto_update,
    });
    if (nv) {
      alerts.push({
        kind: "THEME_UPDATE",
        severity: t.active ? "WARNING" : "INFO",
        key: `update:THEME:${t.slug}`,
        title: `Tema ${t.name || t.slug} ${t.version ?? "?"} → ${nv}${t.active ? "" : " (non attivo)"}`,
        details: { slug: t.slug, from: t.version ?? null, to: nv, active: !!t.active },
      });
    }
  }

  // Ambiente
  if (report.env?.debug_display) {
    alerts.push({
      kind: "DEBUG_ENABLED",
      severity: "WARNING",
      key: "debug",
      title: "WP_DEBUG_DISPLAY attivo: gli errori PHP sono visibili ai visitatori",
    });
  }

  // Sicurezza
  const integ = report.security?.integrity;
  if (integ && integ.ok === false) {
    const modified = clip(integ.modified);
    const missing = clip(integ.missing);
    const unknown = clip(integ.unknown);
    const parts = [
      modified.total ? `${modified.total} modificati` : "",
      unknown.total ? `${unknown.total} estranei` : "",
      missing.total ? `${missing.total} mancanti` : "",
    ].filter(Boolean);
    alerts.push({
      kind: "CORE_INTEGRITY",
      // File mancanti da soli sono spesso un aggiornamento incompleto.
      severity: modified.total || unknown.total ? "CRITICAL" : "WARNING",
      key: "integrity",
      title: `File del core diversi dall'originale: ${parts.join(", ")}`,
      details: { modified, missing, unknown },
    });
  }
  const up = report.security?.uploads_php;
  if (up?.files && up.files.length > 0) {
    const files = clip(up.files);
    alerts.push({
      kind: "UPLOADS_PHP",
      severity: "CRITICAL",
      key: "uploads-php",
      title: `${files.total}${up.truncated ? "+" : ""} file PHP dentro wp-content/uploads`,
      details: { files, truncated: !!up.truncated },
    });
  }

  // Scansione approfondita: considerata solo se attiva in Radar (spenta →
  // gli alert relativi si chiudono).
  const pi = opts.deepScan ? report.security?.plugin_integrity : undefined;
  const altered = (pi?.plugins ?? []).filter((p) => (p.modified?.length ?? 0) + (p.unknown?.length ?? 0) > 0);
  if (altered.length > 0) {
    const phpTouched = altered.some((p) => [...(p.modified ?? []), ...(p.unknown ?? [])].some((f) => /\.(php\d?|phtml|phar)$/i.test(f)));
    alerts.push({
      kind: "PLUGIN_INTEGRITY",
      severity: phpTouched ? "CRITICAL" : "WARNING",
      key: "plugin-integrity",
      title: `File diversi dall'originale wordpress.org in ${altered.length} plugin: ${altered
        .slice(0, 5)
        .map((p) => p.name || p.slug)
        .join(", ")}${altered.length > 5 ? "…" : ""}`,
      details: {
        plugins: altered.slice(0, MAX_LIST).map((p) => ({
          slug: p.slug,
          name: p.name ?? null,
          version: p.version ?? null,
          modified: clip(p.modified),
          unknown: clip(p.unknown),
        })),
      },
    });
  }
  const mw = opts.deepScan ? report.security?.malware : undefined;
  const findings = (mw?.findings ?? []).filter((f) => f.severity !== "low");
  if (findings.length > 0) {
    const high = findings.filter((f) => f.severity === "high");
    const files = new Set(findings.map((f) => f.file));
    alerts.push({
      kind: "MALWARE_SUSPECT",
      severity: high.length > 0 ? "CRITICAL" : "WARNING",
      key: "malware",
      title: `Codice sospetto in ${files.size}${mw?.truncated ? "+" : ""} file${high.length ? ` (${high.length} segnalazioni gravi)` : ""}`,
      details: {
        findings: [...high, ...findings.filter((f) => f.severity !== "high")].slice(0, 50).map((f) => ({
          file: f.file,
          rule: f.rule,
          label: f.label ?? null,
          severity: f.severity,
          line: f.line ?? null,
          excerpt: f.excerpt ?? null,
        })),
        total: findings.length,
        truncated: !!mw?.truncated,
        scanned: mw?.scanned ?? null,
      },
    });
  }

  // Plugin disattivato dal pannello (dalla 1.0.1 il plugin lo riporta)
  const agent = report.agent;
  if (agent?.deactivated_by) {
    const when = agent.deactivated_at
      ? new Date(agent.deactivated_at * 1000).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" })
      : null;
    alerts.push({
      kind: "AGENT_ERROR",
      severity: agent.loader ? "WARNING" : "CRITICAL",
      key: "agent-deactivated",
      title: agent.loader
        ? `Radar Vigilantes disattivato dal pannello da ${agent.deactivated_by}${when ? ` (${when})` : ""}: resta attivo tramite il loader`
        : `Radar Vigilantes disattivato dal pannello da ${agent.deactivated_by}${when ? ` (${when})` : ""}: il monitoraggio si ferma`,
      details: { user: agent.deactivated_by, at: agent.deactivated_at ?? null, loader: !!agent.loader },
    });
  }

  // Amministratori (solo se il plugin li riporta)
  const adminLogins = (report.admins ?? []).map((a) => a.login);
  if (report.admins && previousAdminLogins) {
    const prev = new Set(previousAdminLogins);
    for (const a of report.admins) {
      if (prev.has(a.login)) continue;
      alerts.push({
        kind: "NEW_ADMIN",
        severity: "CRITICAL",
        key: `admin:${a.login}`,
        title: `Nuovo amministratore: ${a.login}${a.email ? ` <${a.email}>` : ""}`,
        details: { id: a.id, login: a.login, email: a.email ?? null, registered: a.registered ?? null },
      });
    }
  }

  return {
    components,
    alerts,
    adminLogins,
    wpVersion: report.core.version,
    phpVersion: report.env?.php ?? null,
    pluginVersion: report.plugin_version,
  };
}

/** Amministratori salvati nell'ultimo report (null se non c'è un report). */
export function adminLoginsFromStored(report: unknown): string[] | null {
  if (!report || typeof report !== "object") return null;
  const admins = (report as { admins?: unknown }).admins;
  if (!Array.isArray(admins)) return null;
  return admins
    .map((a) => (a && typeof a === "object" ? (a as { login?: unknown }).login : null))
    .filter((l): l is string => typeof l === "string");
}

/** Confronto tra versioni "x.y.z" (anche con suffissi): <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10));
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
