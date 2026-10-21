import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { CRON_RUN_STATUS_LABELS, cronMeta } from "@/lib/cron/meta";
import { CronDetailsTable } from "../../cron-details-table";

export const dynamic = "force-dynamic";

/** Dettaglio di un'esecuzione cron: conteggi, errore e voci elaborate. */
export default async function CronRunDetailPage({ params }: { params: { id: string } }) {
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Sezione riservata agli amministratori.
      </p>
    );
  }
  const run = await prisma.cronRun.findUnique({ where: { id: params.id } });
  if (!run) notFound();
  const details = Array.isArray(run.details) ? (run.details as Record<string, unknown>[]) : [];
  const duration =
    run.finishedAt != null
      ? `${Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))} s`
      : "—";

  const rows: [string, React.ReactNode][] = [
    ["Cron", cronMeta(run.name)?.label ?? run.name],
    ["Stato", CRON_RUN_STATUS_LABELS[run.status] ?? run.status],
    ["Origine", run.trigger === "MANUAL" ? `Manuale · ${run.triggeredBy ?? "?"}` : "Programmato (crontab)"],
    ["Avvio", <span key="s" className="font-mono">{formatRomeDateTime(run.startedAt)}</span>],
    ["Fine", run.finishedAt ? <span key="f" className="font-mono">{formatRomeDateTime(run.finishedAt)}</span> : "—"],
    ["Durata", duration],
    ["Candidati", run.candidates],
    ["Eseguiti", run.sent],
    ["Saltati", run.skipped],
    ["Falliti", run.failed],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/log?tab=cron" className="text-sm text-slate-500 hover:underline">
          ← Cron
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {cronMeta(run.name)?.label ?? run.name} · {formatRomeDateTime(run.startedAt)}
        </h1>
      </div>
      {run.error ? (
        <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
          {run.error}
        </pre>
      ) : null}
      <section className="card p-6">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card overflow-hidden">
        <h2 className="mono-label px-4 pt-4">Voci elaborate</h2>
        <CronDetailsTable details={details} />
      </section>
    </div>
  );
}
