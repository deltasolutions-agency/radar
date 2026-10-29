// Metadati dei cron (puri, usabili anche lato client): nomi, etichette, orari
// informativi (il crontab del server NON è gestito dall'app) e soglie di ritardo.

export const CRON_META = [
  { name: "reminders", label: "Reminder scadenze", schedule: "ogni giorno alle 8:00", maxAgeHours: 26, charges: false },
  { name: "auto-charge", label: "Addebiti automatici", schedule: "ogni giorno alle 9:00", maxAgeHours: 26, charges: true },
  { name: "autocharge-reminders", label: "Solleciti attivazione rinnovo", schedule: "ogni ora", maxAgeHours: 2, charges: false },
  { name: "ledger-alerts", label: "Alert Amministrazione", schedule: "ogni giorno alle 8:30", maxAgeHours: 26, charges: false },
] as const;

export type CronMeta = (typeof CRON_META)[number];
export type CronMetaName = CronMeta["name"];

export function cronMeta(name: string): CronMeta | undefined {
  return CRON_META.find((c) => c.name === name);
}

/** Parola di conferma (case-sensitive, spazi esterni ignorati) per l'auto-charge manuale. */
export const AUTOCHARGE_CONFIRM_WORD = "ADDEBITA";

/** Validità di un'anteprima per abilitare "Esegui ora". */
export const PREVIEW_VALIDITY_MS = 15 * 60 * 1000;

/** Stato sintetico di un cron per i badge (pausa, errore, fermo, ok). */
export function cronHealth(
  meta: Pick<CronMeta, "maxAgeHours">,
  enabled: boolean,
  lastRun: { status: string; startedAt: Date } | null,
  now: number = Date.now(),
): { text: string; tone: "ok" | "bad" | "muted"; stale: boolean } {
  const stale = !lastRun || now - lastRun.startedAt.getTime() > meta.maxAgeHours * 3_600_000;
  if (!enabled) return { text: "In pausa", tone: "muted", stale };
  if (!lastRun) return { text: "Mai eseguito", tone: "bad", stale };
  if (lastRun.status === "FAILED") return { text: "Errore", tone: "bad", stale };
  if (stale) return { text: `Fermo da oltre ${meta.maxAgeHours} ore`, tone: "bad", stale };
  if (lastRun.status === "RUNNING") return { text: "In corso", tone: "ok", stale };
  return { text: "OK", tone: "ok", stale };
}

export const CRON_RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: "In corso",
  SUCCESS: "Completato",
  FAILED: "Fallito",
  PAUSED: "In pausa",
};
