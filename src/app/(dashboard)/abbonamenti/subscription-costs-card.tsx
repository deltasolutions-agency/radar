import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/format";
import { annualCostCents, formatPercent, periodLabel } from "@/lib/costs";
import { loadMargins } from "@/lib/costs-server";
import { AddCostToSubscription, UnlinkCostButton } from "../amministrazione/costi/cost-actions";

/** Riquadro "Costi e margine" nella scheda abbonamento (solo admin). */
export async function SubscriptionCostsCard({ subscriptionId }: { subscriptionId: string }) {
  const [margins, costs] = await Promise.all([
    loadMargins(),
    prisma.cost.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, supplier: true, amountCents: true, periodMonths: true, vatPercent: true, allocations: { select: { subscriptionId: true } } },
    }),
  ]);
  const m = margins.subscriptions.get(subscriptionId);
  if (!m) return null;
  const options = costs
    .filter((c) => !c.allocations.some((a) => a.subscriptionId === subscriptionId))
    .map((c) => {
      const n = c.allocations.length;
      const after = Math.round(annualCostCents(c.amountCents, c.periodMonths, c.vatPercent) / (n + 1));
      return {
        id: c.id,
        label: `${c.name}${c.supplier ? ` (${c.supplier})` : ""} · ${formatEur(c.amountCents)} ${periodLabel(c.periodMonths).toLowerCase()} · qui ${formatEur(after)}/anno${
          n ? ` (diviso su ${n + 1})` : ""
        }`,
      };
    });
  const pct = m.revenueCents > 0 ? (m.marginCents / m.revenueCents) * 100 : null;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Costi e margine</h2>
          <p className="text-sm text-slate-500">
            Richiama i tuoi costi usati da questo abbonamento: ognuno si divide in parti uguali tra gli abbonamenti che lo richiamano.
          </p>
        </div>
        <Link href="/amministrazione/costi" className="text-sm font-medium text-brand hover:underline">
          Elenco costi →
        </Link>
      </div>
      <div className="grid gap-px border-b border-line-soft bg-line-soft sm:grid-cols-3">
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Ricavo/anno</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatEur(m.revenueCents)}</p>
        </div>
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Costi/anno (netti)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatEur(m.costCents)}</p>
        </div>
        <div className="bg-white px-5 py-3">
          <p className="mono-label">Margine/anno</p>
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
              <span className="min-w-[12rem] flex-1">
                <Link href={`/amministrazione/costi/${a.costId}`} className="text-ink hover:text-brand hover:underline">
                  {a.costName}
                </Link>
                {a.supplier ? <span className="text-slate-500"> · {a.supplier}</span> : null}
              </span>
              <span className="font-mono text-xs text-slate-500">
                {a.sharedWith > 1 ? `diviso su ${a.sharedWith} abbonamenti (${formatPercent(a.effectivePercent)})` : "solo questo abbonamento"}
              </span>
              <span className="w-28 text-right tabular-nums">{formatEur(a.annualShareCents)}/anno</span>
              <UnlinkCostButton allocationId={a.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-b border-line-soft px-5 py-3 text-sm text-slate-500">Nessun costo richiamato.</p>
      )}
      <div className="px-5 py-4">
        <AddCostToSubscription subscriptionId={subscriptionId} options={options} />
      </div>
    </section>
  );
}
