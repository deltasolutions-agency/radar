import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { CRON_META, CRON_RUN_STATUS_LABELS, cronHealth, cronMeta } from "@/lib/cron/meta";
import { CronControl } from "./cron-control";

const PAGE_SIZE = 30;

const STATUS_TONE: Record<string, string> = {
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED: "border-red-200 bg-red-50 text-red-700",
  RUNNING: "border-sky-200 bg-sky-50 text-sky-700",
  PAUSED: "border-slate-200 bg-slate-100 text-slate-600",
};

/** Tab "Cron" della sezione Log (solo admin): controlli e storico esecuzioni. */
export async function CronTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const cronFilter = cronMeta(searchParams.cron ?? "")?.name;
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const where: Prisma.CronRunWhereInput = cronFilter ? { name: cronFilter } : {};

  const [settings, lastRuns, total, runs] = await Promise.all([
    prisma.cronSetting.findMany(),
    Promise.all(
      CRON_META.map((c) =>
        prisma.cronRun.findFirst({ where: { name: c.name }, orderBy: { startedAt: "desc" } }),
      ),
    ),
    prisma.cronRun.count({ where }),
    prisma.cronRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) =>
    `/log?tab=cron${cronFilter ? `&cron=${cronFilter}` : ""}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {CRON_META.map((c, i) => {
          const enabled = settings.find((s) => s.name === c.name)?.enabled ?? true;
          const last = lastRuns[i];
          const health = cronHealth(c, enabled, last);
          return (
            <CronControl
              key={c.name}
              name={c.name}
              label={c.label}
              schedule={c.schedule}
              charges={c.charges}
              enabled={enabled}
              statusBadge={{ text: health.text, tone: health.tone }}
              lastRunLabel={
                last ? (
                  <>
                    Ultima esecuzione:{" "}
                    <Link href={`/log/cron/${last.id}`} className="font-mono hover:underline">
                      {formatRomeDateTime(last.startedAt)}
                    </Link>{" "}
                    · {CRON_RUN_STATUS_LABELS[last.status] ?? last.status}
                    {last.trigger === "MANUAL" ? ` (manuale, ${last.triggeredBy ?? "?"})` : ""} ·{" "}
                    {last.sent} eseguiti · {last.skipped} saltati · {last.failed} falliti
                  </>
                ) : (
                  "Nessuna esecuzione registrata."
                )
              }
            />
          );
        })}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="mono-label">Storico esecuzioni</h2>
          <form method="get" action="/log" className="flex items-center gap-2">
            <input type="hidden" name="tab" value="cron" />
            <select name="cron" defaultValue={cronFilter ?? ""} className="field" aria-label="Filtra per cron">
              <option value="">Tutti i cron</option>
              {CRON_META.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost">
              Filtra
            </button>
          </form>
        </div>
        <div className="card overflow-hidden">
          {runs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">Nessuna esecuzione.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left mono-label">
                    <th className="px-4 py-3 font-medium">Avvio</th>
                    <th className="px-4 py-3 font-medium">Cron</th>
                    <th className="px-4 py-3 font-medium">Origine</th>
                    <th className="px-4 py-3 font-medium">Stato</th>
                    <th className="px-4 py-3 font-medium text-right">Eseguiti</th>
                    <th className="px-4 py-3 font-medium text-right">Saltati</th>
                    <th className="px-4 py-3 font-medium text-right">Falliti</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                        <Link href={`/log/cron/${r.id}`} className="hover:underline">
                          {formatRomeDateTime(r.startedAt)}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{cronMeta(r.name)?.label ?? r.name}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {r.trigger === "MANUAL" ? `Manuale · ${r.triggeredBy ?? "?"}` : "Programmato"}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] ?? ""}`}>
                          {CRON_RUN_STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{r.sent}</td>
                      <td className="px-4 py-2 text-right font-mono">{r.skipped}</td>
                      <td className="px-4 py-2 text-right font-mono">{r.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {pages > 1 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">
              Pagina {page} di {pages}
            </span>
            {page > 1 ? (
              <Link href={qs(page - 1)} className="btn-ghost">
                ← Precedenti
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={qs(page + 1)} className="btn-ghost">
                Successive →
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
