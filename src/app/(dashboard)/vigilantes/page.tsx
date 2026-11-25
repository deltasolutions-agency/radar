import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { clientDisplayName } from "@/lib/cron/common";
import { SITE_HEALTH, STALE_REPORT_HOURS, VIGILANTES_ALERT_RECIPIENT, siteHealth } from "@/lib/vigilantes/meta";
import { SiteFormButton } from "./site-actions";

export const dynamic = "force-dynamic";

const FILTERS = {
  tutti: "Tutti",
  problemi: "Con alert",
  aggiornamenti: "Con aggiornamenti",
  giu: "Non raggiungibili",
} as const;
type Filter = keyof typeof FILTERS;

export default async function VigilantesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>
    );
  }
  const filter: Filter = searchParams.f && searchParams.f in FILTERS ? (searchParams.f as Filter) : "tutti";
  const q = searchParams.q?.trim() ?? "";

  const [sites, clients] = await Promise.all([
    prisma.wpSite.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { url: { contains: q, mode: "insensitive" } },
              { client: { name: { contains: q, mode: "insensitive" } } },
              { client: { ragioneSociale: { contains: q, mode: "insensitive" } } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
      include: {
        client: { select: { id: true, name: true, ragioneSociale: true } },
        alerts: { where: { resolvedAt: null }, select: { kind: true, severity: true, acknowledgedAt: true } },
      },
    }),
    prisma.client.findMany({
      where: { status: { not: "CESSATO" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, ragioneSociale: true },
    }),
  ]);

  const rows = sites.map((s) => {
    const health = siteHealth(s, s.alerts);
    const updates = s.alerts.filter((a) => a.kind.endsWith("_UPDATE")).length;
    const critical = s.alerts.filter((a) => a.severity === "CRITICAL").length;
    return { s, health, updates, critical };
  });
  const enabled = rows.filter((r) => r.s.enabled);
  const counts = {
    total: enabled.length,
    updates: enabled.filter((r) => r.updates > 0).length,
    critical: enabled.filter((r) => r.critical > 0).length,
    down: enabled.filter((r) => r.health === "DOWN").length,
  };
  const shown = rows.filter((r) => {
    if (filter === "problemi") return r.s.alerts.length > 0;
    if (filter === "aggiornamenti") return r.updates > 0;
    if (filter === "giu") return r.health === "DOWN";
    return true;
  });
  const staleBefore = Date.now() - STALE_REPORT_HOURS * 3_600_000;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vigilantes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Aggiornamenti e sicurezza dei siti WordPress, tramite il plugin Radar Vigilantes.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/vigilantes/plugin/download" className="btn-ghost">
            Scarica plugin
          </a>
          <SiteFormButton clients={clients.map((c) => ({ id: c.id, label: clientDisplayName(c) }))} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="mono-label">Siti monitorati</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{counts.total}</p>
        </div>
        <div className={`card p-4 ${counts.updates ? "border-amber-200 bg-amber-50" : ""}`}>
          <p className="mono-label">Da aggiornare</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${counts.updates ? "text-amber-800" : ""}`}>
            {counts.updates}
          </p>
        </div>
        <div className={`card p-4 ${counts.critical ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Con allarmi critici</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${counts.critical ? "text-red-700" : ""}`}>
            {counts.critical}
          </p>
        </div>
        <div className={`card p-4 ${counts.down ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Non raggiungibili</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${counts.down ? "text-red-700" : ""}`}>
            {counts.down}
          </p>
        </div>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-slate-500">
          Mostra
          <select name="f" defaultValue={filter} className="field mt-1 w-auto">
            {Object.entries(FILTERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[14rem] flex-1 text-xs text-slate-500">
          Cerca
          <input type="search" name="q" defaultValue={q} placeholder="Nome, URL o cliente" className="field mt-1" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Filtra
          </button>
          <Link href="/vigilantes" className="btn-ghost">
            Azzera
          </Link>
        </div>
      </form>

      <div className="card overflow-hidden">
        {shown.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {sites.length === 0 && !q
              ? 'Nessun sito ancora. Usa "+ Nuovo sito", poi installa il plugin e incolla la chiave di collegamento.'
              : "Nessun sito corrisponde ai filtri."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-3 py-3 font-medium">Sito</th>
                  <th className="px-3 py-3 font-medium">Cliente</th>
                  <th className="px-3 py-3 font-medium">WordPress</th>
                  <th className="px-3 py-3 font-medium">Aggiornamenti</th>
                  <th className="px-3 py-3 font-medium">Stato</th>
                  <th className="px-3 py-3 font-medium">Ultimo report</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ s, health, updates, critical }) => {
                  const h = SITE_HEALTH[health];
                  const stale = s.lastReportAt && s.lastReportAt.getTime() < staleBefore;
                  return (
                    <tr key={s.id} className="border-b border-line-soft align-top last:border-0">
                      <td className="px-3 py-3">
                        <Link href={`/vigilantes/${s.id}`} className="font-medium text-ink hover:underline">
                          {s.name}
                        </Link>
                        <p className="font-mono text-xs text-slate-500">{s.url.replace(/^https?:\/\//, "")}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {s.client ? (
                          <Link href={`/clienti/${s.client.id}`} className="hover:underline">
                            {clientDisplayName(s.client)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                        {s.wpVersion ?? "—"}
                        {s.phpVersion ? <span className="block text-slate-500">PHP {s.phpVersion}</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        {updates > 0 ? (
                          <span className="font-medium text-amber-800">{updates}</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                        {critical > 0 ? (
                          <span className="ml-2 font-mono text-[11px] text-red-700">
                            {critical} critic{critical === 1 ? "o" : "i"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${h.style}`}
                        >
                          {h.label}
                        </span>
                        {s.deepScan ? <p className="mt-1 font-mono text-[11px] text-slate-500">scansione approfondita</p> : null}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 font-mono text-xs ${stale ? "text-red-700" : "text-slate-600"}`}>
                        {s.lastReportAt ? formatRomeDateTime(s.lastReportAt) : "mai"}
                        {s.lastReportSource ? (
                          <span className="block text-slate-400">{s.lastReportSource === "PULL" ? "controllo" : "evento"}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Radar controlla i siti ogni giorno alle 7:30 e manda un riepilogo a {VIGILANTES_ALERT_RECIPIENT}; gli allarmi
        critici (sito giù, nuovo amministratore, file alterati, codice sospetto) arrivano subito. In rosso l&apos;ultimo
        report se più vecchio di {STALE_REPORT_HOURS} ore.
      </p>
    </div>
  );
}
