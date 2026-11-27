import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/format";
import { formatPercent, periodLabel } from "@/lib/costs";
import { loadMargins } from "@/lib/costs-server";
import { AddAllocationForm, AllocationControls } from "../amministrazione/costi/cost-actions";

/** Riquadro "Costi e margine" nella scheda abbonamento (solo admin). */
export async function SubscriptionCostsCard({ subscriptionId }: { subscriptionId: string }) {
  const [margins, costs] = await Promise.all([
    loadMargins(),
    prisma.cost.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, supplier: true, amountCents: true, periodMonths: true, allocations: { select: { subscriptionId: true } } },
    }),
  ]);
  const m = margins.subscriptions.find((s) => s.id === subscriptionId);
  if (!m) return null;
  const options = costs
    .filter((c) => !c.allocations.some((a) => a.subscriptionId === subscriptionId))
    .map((c) => ({
      id: c.id,
      label: `${c.name}${c.supplier ? ` (${c.supplier})` : ""} · ${formatEur(c.amountCents)} ${periodLabel(c.periodMonths).toLowerCase()}${
        c.allocations.length ? ` · già su ${c.allocations.length}` : ""
      }`,
    }));
  const pct = m.revenueCents > 0 ? (m.marginCents / m.revenueCents) * 100 : null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Costi e margine</h2>
          <p className="text-sm text-slate-500">Su base annua. Visibile solo agli amministratori.</p>
        </div>
        <Link href="/amministrazione/costi" className="text-sm font-medium text-brand hover:underline">
          Tutti i costi →
        </Link>
      </div>
      <div className="grid gap-px border-b border-line-soft bg-line-soft sm:grid-cols-3">
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Ricavo/anno</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatEur(m.revenueCents)}</p>
        </div>
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Costi/anno</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatEur(m.allocatedCostCents + m.catalogCostCents)}</p>
          {m.catalogCostCents > 0 ? <p className="text-xs text-slate-500">di cui {formatEur(m.catalogCostCents)} da listino servizi</p> : null}
        </div>
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Margine</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${m.marginCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
            {formatEur(m.marginCents)}
            {pct !== null ? <span className="ml-2 font-mono text-xs font-normal text-slate-500">{formatPercent(pct)}</span> : null}
          </p>
        </div>
      </div>
      {m.allocations.length > 0 ? (
        <ul>
          {m.allocations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-2.5 text-sm">
              <Link href={`/amministrazione/costi/${a.costId}`} className="min-w-[12rem] flex-1 text-ink hover:text-brand hover:underline">
                {a.costName}
              </Link>
              <span className="font-mono text-xs text-slate-500">
                {formatPercent(a.effectivePercent)} {a.sharePercent === null ? "(parti uguali)" : "(fissata)"}
              </span>
              <span className="w-24 text-right tabular-nums">{formatEur(a.annualShareCents)}</span>
              <AllocationControls id={a.id} sharePercent={a.sharePercent} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-b border-line-soft px-5 py-3 text-sm text-slate-500">Nessun costo collegato a questo abbonamento.</p>
      )}
      <div className="px-5 py-4">
        <AddAllocationForm mode="cost" fixedId={subscriptionId} options={options} />
      </div>
    </section>
  );
}
