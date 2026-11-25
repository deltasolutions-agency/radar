// Vigilantes — etichette e costanti pure (usabili anche lato client).

export const VIGILANTES_ALERT_RECIPIENT = "hello@deltasolutions.agency";

/** Oltre questo intervallo senza report un sito è considerato "silenzioso". */
export const STALE_REPORT_HOURS = 48;

export type AlertKindValue =
  | "CORE_UPDATE"
  | "PLUGIN_UPDATE"
  | "THEME_UPDATE"
  | "SITE_UNREACHABLE"
  | "AGENT_ERROR"
  | "NEW_ADMIN"
  | "CORE_INTEGRITY"
  | "UPLOADS_PHP"
  | "DEBUG_ENABLED"
  | "PLUGIN_INTEGRITY"
  | "MALWARE_SUSPECT";

export type AlertSeverityValue = "INFO" | "WARNING" | "CRITICAL";

export const ALERT_KIND_LABELS: Record<AlertKindValue, string> = {
  CORE_UPDATE: "Aggiornamento WordPress",
  PLUGIN_UPDATE: "Aggiornamento plugin",
  THEME_UPDATE: "Aggiornamento tema",
  SITE_UNREACHABLE: "Sito non raggiungibile",
  AGENT_ERROR: "Plugin non risponde",
  NEW_ADMIN: "Nuovo amministratore",
  CORE_INTEGRITY: "File del core alterati",
  UPLOADS_PHP: "PHP in uploads",
  DEBUG_ENABLED: "Debug visibile",
  PLUGIN_INTEGRITY: "File di plugin alterati",
  MALWARE_SUSPECT: "Codice sospetto",
};

export const SEVERITY_LABELS: Record<AlertSeverityValue, string> = {
  INFO: "Info",
  WARNING: "Attenzione",
  CRITICAL: "Critico",
};

export const SEVERITY_STYLES: Record<AlertSeverityValue, string> = {
  INFO: "bg-slate-50 text-slate-600 border-slate-200",
  WARNING: "bg-amber-50 text-amber-800 border-amber-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

export const SEVERITY_RANK: Record<AlertSeverityValue, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

/** Alert che si chiudono solo a mano ("Segna come visto" li risolve). */
export const STICKY_ALERT_KINDS: AlertKindValue[] = ["NEW_ADMIN"];

export type SiteHealth = "OK" | "UPDATES" | "CRITICAL" | "DOWN" | "PENDING" | "PAUSED";

export const SITE_HEALTH: Record<SiteHealth, { label: string; style: string }> = {
  OK: { label: "Tutto aggiornato", style: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  UPDATES: { label: "Aggiornamenti", style: "bg-amber-50 text-amber-800 border-amber-200" },
  CRITICAL: { label: "Allarme", style: "bg-red-50 text-red-700 border-red-200" },
  DOWN: { label: "Non raggiungibile", style: "bg-red-50 text-red-700 border-red-200" },
  PENDING: { label: "In attesa del plugin", style: "bg-slate-50 text-slate-600 border-slate-200" },
  PAUSED: { label: "In pausa", style: "bg-slate-100 text-slate-500 border-slate-200" },
};

/** Stato sintetico di un sito a partire dai suoi alert aperti. */
export function siteHealth(
  site: { enabled: boolean; lastReportAt: Date | null },
  openAlerts: { kind: string; severity: string }[],
): SiteHealth {
  if (!site.enabled) return "PAUSED";
  if (openAlerts.some((a) => a.kind === "SITE_UNREACHABLE" || a.kind === "AGENT_ERROR")) return "DOWN";
  if (!site.lastReportAt) return "PENDING";
  if (openAlerts.some((a) => a.severity === "CRITICAL")) return "CRITICAL";
  if (openAlerts.some((a) => a.kind.endsWith("_UPDATE"))) return "UPDATES";
  if (openAlerts.length > 0) return "UPDATES";
  return "OK";
}
