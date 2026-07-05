import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/format";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatusValue,
} from "@/lib/validations";
import {
  StatusDonut,
  IncomeBars,
  type StatusDatum,
  type MonthlyDatum,
} from "./dashboard-charts";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MONTHS_BACK = 12;
const MONTH_LABELS = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

export default async function DashboardPage() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * MS_PER_DAY);

  const [
    clientCount,
    serviceCount,
    activeServiceCount,
    statusGroups,
    autoChargeCount,
    dueItems,
    confirmedPayments,
  ] = await Promise.all([
    prisma.client.count(),
    prisma.service.count(),
    prisma.service.count({ where: { active: true } }),
    // Distribuzione dei servizi (SubscriptionItem) per stato.
    prisma.subscriptionItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    // Servizi con addebito automatico attivo.
    prisma.subscriptionItem.count({ where: { autoChargeEnabled: true } }),
    // Righe in scadenza nei prossimi 30 giorni (non cessate) → importo totale.
    prisma.subscriptionItem.findMany({
      where: {
        status: { notIn: ["CESSATO"] },
        endDate: { gte: now, lte: in30 },
      },
      select: { priceCents: true, quantity: true },
    }),
    // Incassi confermati degli ultimi 12 mesi.
    prisma.payment.findMany({
      where: {
        status: "CONFERMATO",
        paidAt: {
          gte: new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1),
        },
      },
      select: { amountCents: true, paidAt: true },
    }),
  ]);

  // ── Metriche ────────────────────────────────────────────────────────────
  const countByStatus = new Map<string, number>(
    statusGroups.map((g) => [g.status, g._count._all]),
  );
  // "Servizi attivi" = righe non cessate (servizi realmente in gestione).
  const cessati = countByStatus.get("CESSATO") ?? 0;
  const totalItems = statusGroups.reduce((s, g) => s + g._count._all, 0);
  const activeItems = totalItems - cessati;

  const dueAmountCents = dueItems.reduce(
    (s, it) => s + it.priceCents * it.quantity,
    0,
  );

  // ── Donut per stato ───────────────────────────────────────────────────────
  const statusData: StatusDatum[] = SUBSCRIPTION_STATUSES.map((s) => ({
    status: s,
    label: SUBSCRIPTION_STATUS_LABELS[s as SubscriptionStatusValue],
    count: countByStatus.get(s) ?? 0,
  }));

  // ── Barre incassi mensili (ultimi 12 mesi) ────────────────────────────────
  const monthly: MonthlyDatum[] = [];
  const bucket = new Map<string, number>();
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    bucket.set(key, 0);
    monthly.push({
      month: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      totalCents: 0,
    });
  }
  const monthKeys = [...bucket.keys()];
  for (const p of confirmedPayments) {
    if (!p.paidAt) continue;
    const key = `${p.paidAt.getFullYear()}-${p.paidAt.getMonth()}`;
    const idx = monthKeys.indexOf(key);
    if (idx >= 0) monthly[idx].totalCents += p.amountCents;
  }

  const metrics = [
    { label: "Servizi attivi", value: String(activeItems) },
    {
      label: "In scadenza (30 gg)",
      value: formatEur(dueAmountCents),
    },
    { label: "Auto-charge attivi", value: String(autoChargeCount) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Panoramica di servizi, scadenze e incassi.
        </p>
      </div>

      {/* Metric card */}
      <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="card p-5">
            <div className="mono-label">{m.label}</div>
            <div className="mt-2 text-2xl font-semibold sm:text-3xl">
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Grafici */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mono-label mb-2">Servizi per stato</h2>
          <StatusDonut data={statusData} />
        </div>
        <div className="card p-5">
          <h2 className="mono-label mb-2">Incassi mensili</h2>
          <IncomeBars data={monthly} />
        </div>
      </div>

      {/* Anagrafiche/catalogo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/clienti"
          className="card p-6 transition hover:shadow-sm"
        >
          <div className="mono-label">Clienti</div>
          <div className="mt-2 text-3xl font-semibold">{clientCount}</div>
        </Link>
        <Link
          href="/servizi"
          className="card p-6 transition hover:shadow-sm"
        >
          <div className="mono-label">Servizi a catalogo</div>
          <div className="mt-2 text-3xl font-semibold">{serviceCount}</div>
          <div className="mt-1 text-xs text-slate-500">
            {activeServiceCount} attivi
          </div>
        </Link>
      </div>
    </div>
  );
}
