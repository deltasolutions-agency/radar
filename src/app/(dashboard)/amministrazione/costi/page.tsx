import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatEur, formatDate } from "@/lib/format";
import { COST_CATEGORY_LABELS, formatPercent, periodLabel, type CostCategory } from "@/lib/costs";
import { loadMargins } from "@/lib/costs-server";
import { AdminTabs } from "../admin-tabs";
import { CostButton } from "./cost-actions";

export const dynamic = "force-dynamic";

const VIEWS = { attivi: "In uso", archivio: "Dismessi" } as const;
type View = keyof typeof VIEWS;

export default async function CostiPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!(await getAdminSession())) {
    return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>;
  }
  const view: View = searchParams.vista === "archivio" ? "archivio" : "attivi";

  const [costs, archivedCount, margins] = await Promise.all([
    prisma.cost.findMany({
      where: { active: view === "attivi" },
      orderBy: [{ renewalDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      include: { _count: { select: { allocations: true } } },
    }),
    prisma.cost.count({ where: { active: false } }),
    loadMargins(),
  ]);

  const summaries = [...margins.costs.values()];
  const annualCosts = summaries.reduce((s, c) => s + c.annualCents, 0);
  const unassignedCents = summaries.reduce((s, c) => s + Math.round((c.annualCents * c.unassignedPercent) / 100), 0);
  const revenue = margins.subscriptions.reduce((s, m) => s + m.revenueCents, 0);
  const catalog = margins.subscriptions.reduce((s, m) => s + m.catalogCostCents, 0);
  const margin = revenue - catalog - annualCosts;
  const marginRows = margins.subscriptions
    .filter((m) => m.revenueCents > 0 || m.allocatedCostCents > 0)
    .sort((a, b) => a.marginCents - b.marginCents);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Amministrazione</h1>
          <p className="mt-1 text-sm text-slate-500">
            Costi: quello che spendi (hosting, domini, licenze…), ripartito sugli abbonamenti che lo usano per vedere il margine reale.
          </p>
        </div>
        <CostButton />
      </div>

      <AdminTabs active="costi" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="mono-label">Ricavi annui</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(revenue)}</p>
          <p className="text-xs text-slate-500">abbonamenti attivi e in attesa, su base annua</p>
        </div>
        <div className="card p-4">
          <p className="mono-label">Costi annui</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(annualCosts + catalog)}</p>
          <p className="text-xs text-slate-500">
            {formatEur(annualCosts)} costi inseriti{catalog > 0 ? ` + ${formatEur(catalog)} da listino servizi` : ""}
          </p>
        </div>
        <div className={`card p-4 ${margin < 0 ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Margine annuo</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatEur(margin)}</p>
          <p className="text-xs text-slate-500">{revenue > 0 ? `${formatPercent((margin / revenue) * 100)} dei ricavi` : "—"}</p>
        </div>
        <div className={`card p-4 ${unassignedCents > 0 ? "border-amber-200 bg-amber-50" : ""}`}>
          <p className="mono-label">Non ripartiti</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${unassignedCents > 0 ? "text-amber-800" : ""}`}>{formatEur(unassignedCents)}</p>
          <p className="text-xs text-slate-500">costi annui non collegati a nessun abbonamento</p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Vista" className="flex gap-1.5">
            {(Object.keys(VIEWS) as View[]).map((k) => (
              <Link
                key={k}
                href={k === "attivi" ? "/amministrazione/costi" : "/amministrazione/costi?vista=archivio"}
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
              {view === "attivi" ? 'Nessun costo inserito. Usa "+ Nuovo costo" per aggiungere hosting, domini e licenze.' : "Nessun costo dismesso."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="mono-label border-b border-line text-left">
                    <th className="px-4 py-3 font-medium">Costo</th>
                    <th className="px-3 py-3 text-right font-medium">Pagato</th>
                    <th className="px-3 py-3 text-right font-medium">All&apos;anno</th>
                    <th className="px-3 py-3 font-medium">Ripartito su</th>
                    <th className="px-3 py-3 font-medium">Rinnovo</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((c) => {
                    const sum = margins.costs.get(c.id);
                    return (
                      <tr key={c.id} className="border-b border-line-soft last:border-0 hover:bg-canvas/60">
                        <td className="px-4 py-3">
                          <Link href={`/amministrazione/costi/${c.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {[c.supplier, c.category ? COST_CATEGORY_LABELS[c.category as CostCategory] : null].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {formatEur(c.amountCents, c.currency)}
                          <span className="block text-xs text-slate-500">{periodLabel(c.periodMonths).toLowerCase()}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
                          {formatEur(Math.round((c.amountCents * 12) / c.periodMonths), c.currency)}
                        </td>
                        <td className="px-3 py-3">
                          {c._count.allocations === 0 ? (
                            <span className="text-xs font-medium text-amber-800">nessun abbonamento</span>
                          ) : (
                            <span className="text-sm">
                              {c._count.allocations} abbonament{c._count.allocations === 1 ? "o" : "i"}
                              {sum && sum.unassignedPercent > 0.005 ? (
                                <span className="block text-xs text-amber-800">{formatPercent(sum.unassignedPercent)} non ripartito</span>
                              ) : null}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{c.renewalDate ? formatDate(c.renewalDate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line-soft px-5 py-4">
          <h2 className="text-base font-semibold">Margine per abbonamento</h2>
          <p className="text-sm text-slate-500">Su base annua, dal meno redditizio. Apri un abbonamento per collegargli i costi.</p>
        </div>
        {marginRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nessun abbonamento con ricavi o costi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="mono-label border-b border-line text-left">
                  <th className="px-5 py-3 font-medium">Abbonamento</th>
                  <th className="px-3 py-3 text-right font-medium">Ricavo/anno</th>
                  <th className="px-3 py-3 text-right font-medium">Costi/anno</th>
                  <th className="px-3 py-3 text-right font-medium">Margine</th>
                  <th className="px-5 py-3 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {marginRows.map((m) => {
                  const costs = m.allocatedCostCents + m.catalogCostCents;
                  return (
                    <tr key={m.id} className="border-b border-line-soft last:border-0">
                      <td className="max-w-[28rem] px-5 py-2.5">
                        <Link href={`/abbonamenti/${m.id}`} className="text-ink hover:text-brand hover:underline">
                          {m.label}
                        </Link>
                        {m.allocations.length === 0 && m.catalogCostCents === 0 ? (
                          <span className="ml-2 text-xs text-slate-400">nessun costo collegato</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatEur(m.revenueCents)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">{formatEur(costs)}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums ${m.marginCents < 0 ? "text-red-700" : ""}`}>
                        {formatEur(m.marginCents)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono text-xs text-slate-500">
                        {m.revenueCents > 0 ? formatPercent((m.marginCents / m.revenueCents) * 100) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Tutto su base annua: un costo mensile conta 12 volte, uno biennale la metà; i ricavi seguono la periodicità di ogni servizio. Un costo
        collegato a più abbonamenti si divide in parti uguali, salvo le quote che fissi a mano. Importi come inseriti, senza calcolo IVA.
        {catalog > 0 ? " Nei costi rientra anche il costo fornitore impostato sui servizi a listino: se inserisci qui lo stesso costo, toglilo dal servizio per non contarlo due volte." : ""}
      </p>
    </div>
  );
}
