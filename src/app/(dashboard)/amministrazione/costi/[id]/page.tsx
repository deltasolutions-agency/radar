import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatEur, formatDate } from "@/lib/format";
import { clientDisplayName } from "@/lib/cron/common";
import {
  COST_CATEGORY_LABELS,
  annualCostCents,
  formatPercent,
  periodLabel,
  resolveShares,
  toNumber,
  type CostCategory,
} from "@/lib/costs";
import { subscriptionLabel } from "@/lib/costs-server";
import { AddAllocationForm, AllocationControls, CostButton, CostDeleteButton } from "../cost-actions";

export const dynamic = "force-dynamic";

export default async function CostoPage({ params }: { params: { id: string } }) {
  if (!(await getAdminSession())) {
    return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>;
  }
  const cost = await prisma.cost.findUnique({
    where: { id: params.id },
    include: {
      allocations: {
        orderBy: { createdAt: "asc" },
        include: {
          subscription: {
            select: {
              id: true,
              activationState: true,
              client: { select: { name: true, ragioneSociale: true } },
              items: { select: { status: true, service: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!cost) notFound();

  const linked = new Set(cost.allocations.map((a) => a.subscriptionId));
  const candidates = await prisma.subscription.findMany({
    where: { activationState: { not: "CANCELLED_BEFORE_START" }, id: { notIn: [...linked] } },
    select: {
      id: true,
      client: { select: { name: true, ragioneSociale: true } },
      items: { select: { service: { select: { name: true } } } },
    },
  });
  const options = candidates
    .map((s) => ({ id: s.id, label: subscriptionLabel(clientDisplayName(s.client), s.items.map((it) => it.service.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"));

  const annual = annualCostCents(cost.amountCents, cost.periodMonths);
  const allocs = cost.allocations.map((a) => ({ ...a, sharePercent: toNumber(a.sharePercent) }));
  const { shares, unassignedPercent } = resolveShares(allocs);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/amministrazione/costi" className="text-sm text-slate-500 hover:underline">
            ← Costi
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{cost.name}</h1>
            {!cost.active ? <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-slate-500">dismesso</span> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {[cost.supplier, cost.category ? COST_CATEGORY_LABELS[cost.category as CostCategory] : null].filter(Boolean).join(" · ") || "Nessun fornitore indicato"}
          </p>
        </div>
        <div className="flex gap-2">
          <CostButton
            cost={{
              id: cost.id,
              name: cost.name,
              supplier: cost.supplier,
              category: cost.category,
              amountCents: cost.amountCents,
              periodMonths: cost.periodMonths,
              renewalDate: cost.renewalDate ? cost.renewalDate.toISOString().slice(0, 10) : null,
              notes: cost.notes,
              active: cost.active,
            }}
          />
          <CostDeleteButton id={cost.id} label={cost.name} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="mono-label">Pagato</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(cost.amountCents, cost.currency)}</p>
          <p className="text-xs text-slate-500">{periodLabel(cost.periodMonths).toLowerCase()} · {formatEur(annual, cost.currency)} all&apos;anno</p>
        </div>
        <div className="card p-4">
          <p className="mono-label">Prossimo rinnovo</p>
          <p className="mt-1 text-xl font-semibold">{cost.renewalDate ? formatDate(cost.renewalDate) : "—"}</p>
          <p className="text-xs text-slate-500">promemoria per te, nessun alert automatico</p>
        </div>
        <div className={`card p-4 ${unassignedPercent > 0.005 ? "border-amber-200 bg-amber-50" : ""}`}>
          <p className="mono-label">Ripartizione</p>
          <p className="mt-1 text-xl font-semibold">
            {allocs.length} abbonament{allocs.length === 1 ? "o" : "i"}
          </p>
          <p className={`text-xs ${unassignedPercent > 0.005 ? "text-amber-800" : "text-slate-500"}`}>
            {unassignedPercent > 0.005 ? `${formatPercent(unassignedPercent)} non ripartito` : "100% ripartito"}
          </p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-line-soft px-5 py-4">
          <h2 className="text-base font-semibold">Abbonamenti che lo usano</h2>
          <p className="text-sm text-slate-500">
            Senza quota il costo si divide in parti uguali; fissa una quota % quando un cliente pesa più degli altri.
          </p>
        </div>
        {allocs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Non ancora collegato a nessun abbonamento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="mono-label border-b border-line text-left">
                  <th className="px-5 py-3 font-medium">Abbonamento</th>
                  <th className="px-3 py-3 text-right font-medium">Quota</th>
                  <th className="px-3 py-3 text-right font-medium">Costo/anno</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => {
                  const pct = shares.get(a.id) ?? 0;
                  const s = a.subscription;
                  return (
                    <tr key={a.id} className="border-b border-line-soft last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/abbonamenti/${s.id}`} className="text-ink hover:text-brand hover:underline">
                          {subscriptionLabel(clientDisplayName(s.client), s.items.map((it) => it.service.name))}
                        </Link>
                        {s.activationState === "CANCELLED_BEFORE_START" || s.items.every((it) => it.status === "CESSATO") ? (
                          <span className="ml-2 text-xs text-amber-800">abbonamento non più attivo</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">
                        {formatPercent(pct)}
                        <span className="block text-[11px] text-slate-400">{a.sharePercent === null ? "parti uguali" : "fissata"}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatEur(Math.round((annual * pct) / 100), cost.currency)}</td>
                      <td className="px-5 py-3">
                        <AllocationControls id={a.id} sharePercent={a.sharePercent} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line-soft px-5 py-4">
          <AddAllocationForm mode="subscription" fixedId={cost.id} options={options} />
        </div>
      </section>

      {cost.notes ? (
        <section className="card p-5">
          <h2 className="mono-label mb-2">Note</h2>
          <p className="whitespace-pre-line text-sm">{cost.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
