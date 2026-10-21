import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { CRON_META, cronHealth } from "@/lib/cron/meta";

const TONE = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bad: "border-red-200 bg-red-50 text-red-700",
  muted: "border-slate-200 bg-slate-100 text-slate-600",
};

/** Riquadro "Stato cron" (tab Email): ultima esecuzione e badge per cron. */
export async function CronStatus() {
  const [settings, latest] = await Promise.all([
    prisma.cronSetting.findMany(),
    Promise.all(
      CRON_META.map((c) =>
        prisma.cronRun.findFirst({ where: { name: c.name }, orderBy: { startedAt: "desc" } }),
      ),
    ),
  ]);

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="mono-label">Stato cron</h2>
        <Link href="/log?tab=cron" className="text-xs text-brand hover:underline">
          Gestisci →
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {CRON_META.map((c, i) => {
          const run = latest[i];
          const enabled = settings.find((s) => s.name === c.name)?.enabled ?? true;
          const health = cronHealth(c, enabled, run);
          return (
            <div key={c.name} className="rounded-lg border border-line-soft p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{c.label}</span>
                <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[health.tone]}`}>
                  {health.text}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{c.schedule}</p>
              {run ? (
                <>
                  <p className="mt-2 font-mono text-xs text-slate-600">
                    Ultima: {formatRomeDateTime(run.startedAt)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {run.sent} eseguiti · {run.skipped} saltati · {run.failed} falliti
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
