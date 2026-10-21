import { prisma } from "@/lib/prisma";
import { CRON_NAMES, type CronName } from "@/lib/cron/common";
import { formatRomeDateTime } from "@/lib/email-log-labels";

const HOUR = 60 * 60 * 1000;

// Soglie oltre le quali un cron è considerato fermo.
const CRONS: { name: CronName; label: string; maxAgeMs: number; schedule: string }[] = [
  { name: CRON_NAMES.reminders, label: "Reminder", maxAgeMs: 26 * HOUR, schedule: "ogni giorno 8:00" },
  { name: CRON_NAMES.autoCharge, label: "Addebiti automatici", maxAgeMs: 26 * HOUR, schedule: "ogni giorno 9:00" },
  { name: CRON_NAMES.activationReminders, label: "Solleciti attivazione", maxAgeMs: 2 * HOUR, schedule: "ogni ora" },
];

/** Riquadro "Stato cron": ultima esecuzione reale per cron (da CronRun). */
export async function CronStatus() {
  const now = Date.now();
  const latest = await Promise.all(
    CRONS.map((c) =>
      prisma.cronRun.findFirst({ where: { name: c.name }, orderBy: { startedAt: "desc" } }),
    ),
  );

  return (
    <section className="card p-4">
      <h2 className="mono-label">Stato cron</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {CRONS.map((c, i) => {
          const run = latest[i];
          const stale = !run || now - run.startedAt.getTime() > c.maxAgeMs;
          const errored = !!run?.error;
          const running = !!run && !run.finishedAt && !run.error;
          const bad = stale || errored;
          return (
            <div key={c.name} className="rounded-lg border border-line-soft p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{c.label}</span>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                    bad
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {!run ? "Mai eseguito" : errored ? "Errore" : stale ? "Fermo" : running ? "In corso" : "OK"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{c.schedule}</p>
              {run ? (
                <>
                  <p className="mt-2 font-mono text-xs text-slate-600">
                    Ultima: {formatRomeDateTime(run.startedAt)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {run.sent} inviati/eseguiti · {run.skipped} saltati · {run.failed} falliti
                  </p>
                  {run.error ? (
                    <p className="mt-1 line-clamp-2 text-xs text-red-700" title={run.error}>
                      {run.error.split("\n")[0]}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Nessuna esecuzione registrata.</p>
              )}
              {stale && run ? (
                <p className="mt-1 text-xs text-red-700">
                  Non gira da più di {Math.round(c.maxAgeMs / HOUR)} ore
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
