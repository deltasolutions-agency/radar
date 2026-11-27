import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatEur, formatDate } from "@/lib/format";
import { COST_ALERT_DAYS, COST_CATEGORY_LABELS, annualCostCents, daysUntil, periodLabel, vatLabel, type CostCategory } from "@/lib/costs";
import { romeYmd } from "@/lib/rome-time";
import { loadMargins } from "@/lib/costs-server";
import { AdminTabs } from "../admin-tabs";
import { CostButton, CostDeleteButton, RecurringToggle } from "./cost-actions";
import { CostSearch } from "./cost-search";

export const dynamic = "force-dynamic";

const VIEWS = { attivi: "In uso", archivio: "Dismessi" } as const;
type View = keyof typeof VIEWS;

function RenewalBadge({ date, today }: { date: Date; today: string }) {
  const days = daysUntil(date.toISOString().slice(0, 10), today);
  if (days > COST_ALERT_DAYS) return null;
  const text = days < 0 ? `scaduto da ${-days} gg` : days === 0 ? "oggi" : `tra ${days} gg`;
  return (
    <span className={`ml-2 rounded-full px-1.5 py-0.5 font-mono text-[11px] ${days < 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
      {text}
    </span>
  );
}

export default async function CostiPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!(await getAdminSession())) {
    return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>;
  }
  const view: View = searchParams.vista === "archivio" ? "archivio" : "attivi";
  const q = searchParams.q?.trim().slice(0, 100) ?? "";
  const today = romeYmd(new Date());
  const ci = { contains: q, mode: "insensitive" as const };

  const [costs, archivedCount, margins] = await Promise.all([
    prisma.cost.findMany({
      where: {
        active: view === "attivi",
        // Ricerca: nome, fornitore, note o cliente degli abbonamenti che lo richiamano.
        ...(q
          ? {
              OR: [
                { name: ci },
                { supplier: ci },
                { notes: ci },
                { allocations: { some: { subscription: { client: { OR: [{ name: ci }, { ragioneSociale: ci }] } } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ renewalDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      include: { _count: { select: { allocations: true } } },
    }),
    prisma.cost.count({ where: { active: false } }),
    loadMargins(),
  ]);

  const summaries = [...margins.costs.values()];
  const annualCosts = summaries.reduce((s, c) => s + c.annualCents, 0);
  const unused = summaries.filter((c) => c.subscriptions === 0 && !c.general);
  const generalCents = summaries.filter((c) => c.general).reduce((s, c) => s + c.annualCents, 0);
  const unusedCents = unused.reduce((s, c) => s + c.annualCents, 0);
  const revenue = [...margins.subscriptions.values()].reduce((s, m) => s + m.revenueCents, 0);
  const margin = revenue - annualCosts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Amministrazione</h1>
          <p className="mt-1 text-sm text-slate-500">
            Costi: i servizi che compri dai tuoi provider (hosting, domini, licenze…). Richiamali negli abbonamenti che li usano: il costo si
            divide in parti uguali tra loro.
          </p>
        </div>
        <CostButton />
      </div>

      <AdminTabs active="costi" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="mono-label">Costi annui</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(annualCosts)}</p>
          <p className="text-xs text-slate-500">
            {summaries.length} {summaries.length === 1 ? "costo in uso" : "costi in uso"}
            {generalCents > 0 ? ` · di cui ${formatEur(generalCents)} generali` : ""}
          </p>
        </div>
        <div className="card p-4">
          <p className="mono-label">Ricavi annui</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(revenue)}</p>
          <p className="text-xs text-slate-500">dagli abbonamenti, su base annua</p>
        </div>
        <div className={`card p-4 ${margin < 0 ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Margine annuo</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatEur(margin)}</p>
          <p className="text-xs text-slate-500">ricavi meno tutti i costi, generali compresi</p>
        </div>
        <div className={`card p-4 ${unused.length ? "border-amber-200 bg-amber-50" : ""}`}>
          <p className="mono-label">Non richiamati</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${unused.length ? "text-amber-800" : ""}`}>{formatEur(unusedCents)}</p>
          <p className="text-xs text-slate-500">
            {unused.length} {unused.length === 1 ? "costo" : "costi"} da richiamare in un abbonamento (o da segnare come generali)
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CostSearch initial={q} />
      <div role="group" aria-label="Vista" className="flex gap-1.5">
        {(Object.keys(VIEWS) as View[]).map((k) => (
          <Link
            key={k}
            href={`/amministrazione/costi${k === "archivio" ? "?vista=archivio" : ""}${q ? `${k === "archivio" ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`}
            aria-current={view === k ? "true" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              view === k ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-600 hover:border-slate-400"
            }`}
          >
            {VIEWS[k]}
            {k === "archivio" ? <span className="ml-2 font-mono text-xs opacity-70">{archivedCount}</span> : null}
          </Link>
        ))}
      </div>
      </div>

      <div className="card overflow-hidden">
        {costs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {q
              ? `Nessun costo corrisponde a "${q}".`
              : view === "attivi"
              ? 'Nessun costo. Usa "+ Nuovo costo" per inserire ad esempio l\'hosting condiviso o un dominio che hai comprato.'
              : "Nessun costo dismesso."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="mono-label border-b border-line text-left">
                  <th className="px-4 py-3 font-medium">Costo</th>
                  <th className="px-3 py-3 text-right font-medium">Pagato</th>
                  <th className="px-3 py-3 text-right font-medium">All&apos;anno (netto)</th>
                  <th className="px-3 py-3 font-medium">Richiamato in</th>
                  <th className="px-3 py-3 text-right font-medium">Quota per abbonamento</th>
                  <th className="px-3 py-3 font-medium">Rinnovo</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => {
                  const annual = annualCostCents(c.amountCents, c.periodMonths, c.vatPercent);
                  const n = c._count.allocations;
                  return (
                    <tr key={c.id} className="border-b border-line-soft align-top last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/amministrazione/costi/${c.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {c.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {[c.supplier, c.category ? COST_CATEGORY_LABELS[c.category as CostCategory] : null].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {c.notes ? <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{c.notes}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {formatEur(c.amountCents, c.currency)}
                        <span className="block text-xs text-slate-500">
                          {periodLabel(c.periodMonths).toLowerCase()} · {vatLabel(c.vatPercent)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">{formatEur(annual, c.currency)}</td>
                      <td className="px-3 py-3">
                        {c.general ? (
                          <span className="inline-flex rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-slate-600">
                            Costo generale
                          </span>
                        ) : n === 0 ? (
                          <span className="text-xs font-medium text-amber-800">nessun abbonamento</span>
                        ) : (
                          <Link href={`/amministrazione/costi/${c.id}`} className="text-ink hover:text-brand hover:underline">
                            {n} abbonament{n === 1 ? "o" : "i"}
                          </Link>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {n ? formatEur(Math.round(annual / n), c.currency) : "—"}
                        {n ? <span className="block text-xs text-slate-500">all&apos;anno</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {c.renewalDate ? formatDate(c.renewalDate) : "—"}
                        {c.renewalDate && c.active ? <RenewalBadge date={c.renewalDate} today={today} /> : null}
                        {c.active ? (
                          <span className="block">
                            <RecurringToggle id={c.id} recurring={c.recurring} hasDate={!!c.renewalDate} />
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <CostButton
                            cost={{
                              id: c.id,
                              name: c.name,
                              supplier: c.supplier,
                              category: c.category,
                              amountCents: c.amountCents,
                              periodMonths: c.periodMonths,
                              vatPercent: c.vatPercent,
                              general: c.general,
                              recurring: c.recurring,
                              renewalDate: c.renewalDate ? c.renewalDate.toISOString().slice(0, 10) : null,
                              notes: c.notes,
                              active: c.active,
                            }}
                          />
                          <CostDeleteButton id={c.id} label={c.name} />
                        </div>
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
        Tutto su base annua, confrontato con i prezzi degli abbonamenti (senza IVA): dai costi segnati &quot;IVA inclusa&quot; Radar scorpora il
        22% perché la detrai; gli altri contano per intero. Un costo mensile conta 12 volte, uno biennale la metà. Il margine
        di ogni abbonamento lo trovi nella sua scheda, nel riquadro &quot;Costi e margine&quot;. Ogni giorno alle 10:00 arriva a hello@ l&apos;elenco
        dei costi che si rinnovano entro {COST_ALERT_DAYS} giorni; i costi &quot;ricorrenti&quot;, passata la data, si rinnovano da soli.
      </p>
    </div>
  );
}
