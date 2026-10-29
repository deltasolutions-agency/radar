import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatEur } from "@/lib/format";
import { romeYmd } from "@/lib/rome-time";
import {
  LEDGER_ALERT_RECIPIENT,
  LEDGER_ALERT_REPEAT_DAYS,
  LEDGER_TABS,
  LEDGER_TEXT,
  dayFromYmd,
  daysLate,
  formatDay,
  ledgerState,
  ymdOfDay,
  type LedgerKindValue,
  type LedgerState,
} from "@/lib/ledger";
import { LedgerDeleteButton, LedgerEntryButton, LedgerPaidToggle } from "./ledger-actions";

export const dynamic = "force-dynamic";

const STATE_FILTERS = {
  aperti: "Aperti",
  scaduti: "Scaduti",
  pagati: "Chiusi",
  tutti: "Tutti",
} as const;
type StateFilter = keyof typeof STATE_FILTERS;

const STATE_STYLES: Record<LedgerState, string> = {
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OVERDUE: "bg-red-50 text-red-700 border-red-200",
  DUE_SOON: "bg-amber-50 text-amber-800 border-amber-200",
  OPEN: "bg-slate-50 text-slate-600 border-slate-200",
};

function stateLabel(kind: LedgerKindValue, state: LedgerState, late: number): string {
  if (state === "PAID") return LEDGER_TEXT[kind].paid;
  if (state === "OVERDUE") return `Scaduto da ${late} ${late === 1 ? "giorno" : "giorni"}`;
  if (state === "DUE_SOON") {
    const left = -late;
    return left === 0 ? "Scade oggi" : `Scade tra ${left} ${left === 1 ? "giorno" : "giorni"}`;
  }
  return LEDGER_TEXT[kind].open;
}

export default async function AmministrazioneTabPage({
  params,
  searchParams,
}: {
  params: { tab: string };
  searchParams: Record<string, string | undefined>;
}) {
  if (!(params.tab in LEDGER_TABS)) notFound();
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Sezione riservata agli amministratori.
      </p>
    );
  }

  const kind: LedgerKindValue = LEDGER_TABS[params.tab as keyof typeof LEDGER_TABS];
  const text = LEDGER_TEXT[kind];
  const today = romeYmd(new Date());
  const todayDay = dayFromYmd(today);
  const stato: StateFilter =
    searchParams.stato && searchParams.stato in STATE_FILTERS
      ? (searchParams.stato as StateFilter)
      : "aperti";
  const q = searchParams.q?.trim() ?? "";

  const where: Prisma.LedgerEntryWhereInput = { kind };
  if (stato === "aperti") where.paidAt = null;
  if (stato === "scaduti") Object.assign(where, { paidAt: null, dueDate: { lt: todayDay } });
  if (stato === "pagati") where.paidAt = { not: null };
  if (q) {
    where.OR = [
      { counterparty: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, openAgg, overdueAgg, paidAgg, otherOverdue] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [
        { paidAt: { sort: "desc", nulls: "first" } },
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 500,
    }),
    prisma.ledgerEntry.aggregate({
      where: { kind, paidAt: null },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.ledgerEntry.aggregate({
      where: { kind, paidAt: null, dueDate: { lt: todayDay } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.ledgerEntry.aggregate({
      where: { kind, paidAt: { not: null } },
      _sum: { amountCents: true },
      _count: true,
    }),
    // Scaduti nell'ALTRA tab, per il pallino rosso sul nome della tab.
    prisma.ledgerEntry.count({
      where: { kind: kind === "CREDITO" ? "DEBITO" : "CREDITO", paidAt: null, dueDate: { lt: todayDay } },
    }),
  ]);
  const overdueCount = { [kind]: overdueAgg._count, [kind === "CREDITO" ? "DEBITO" : "CREDITO"]: otherOverdue } as Record<LedgerKindValue, number>;
  const filteredTotal = rows.reduce((s, r) => s + r.amountCents, 0);
  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams({ ...(stato !== "aperti" ? { stato } : {}), ...(q ? { q } : {}), ...next });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "stato" && v === "aperti")) p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Amministrazione</h1>
          <p className="mt-1 text-sm text-slate-500">{text.intro}</p>
        </div>
        <LedgerEntryButton kind={kind} />
      </div>

      <nav className="flex gap-1 border-b border-line text-sm">
        {(Object.keys(LEDGER_TABS) as (keyof typeof LEDGER_TABS)[]).map((slug) => {
          const k = LEDGER_TABS[slug];
          const active = k === kind;
          return (
            <Link
              key={slug}
              href={`/amministrazione/${slug}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 font-medium transition ${
                active ? "border-brand text-ink" : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              {LEDGER_TEXT[k].tab}
              {overdueCount[k] > 0 ? (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 font-mono text-[11px] leading-5 text-white"
                  title={`${overdueCount[k]} scadut${overdueCount[k] === 1 ? "o" : "i"}`}
                >
                  {overdueCount[k]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="mono-label">{text.open}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(openAgg._sum.amountCents ?? 0)}</p>
          <p className="text-xs text-slate-500">
            {openAgg._count} {openAgg._count === 1 ? "voce aperta" : "voci aperte"}
          </p>
        </div>
        <div className={`card p-4 ${overdueAgg._count > 0 ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Di cui scaduto</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${overdueAgg._count > 0 ? "text-red-700" : ""}`}
          >
            {formatEur(overdueAgg._sum.amountCents ?? 0)}
          </p>
          <p className="text-xs text-slate-500">
            {overdueAgg._count} {overdueAgg._count === 1 ? "voce" : "voci"} oltre la scadenza
          </p>
        </div>
        <div className="card p-4">
          <p className="mono-label">{text.paid}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatEur(paidAgg._sum.amountCents ?? 0)}</p>
          <p className="text-xs text-slate-500">
            {paidAgg._count} {paidAgg._count === 1 ? "voce chiusa" : "voci chiuse"}
          </p>
        </div>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-slate-500">
          Stato
          <select name="stato" defaultValue={stato} className="field mt-1 w-auto">
            {Object.entries(STATE_FILTERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[14rem] flex-1 text-xs text-slate-500">
          Cerca
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nome, descrizione o note"
            className="field mt-1"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Filtra
          </button>
          <Link href={`/amministrazione/${text.slug}`} className="btn-ghost">
            Azzera
          </Link>
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {stato === "aperti" && !q ? `${text.empty} Usa "${text.newEntry}" per aggiungerne uno.` : "Nessuna voce corrisponde ai filtri."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-3 py-3 font-medium">Scadenza</th>
                  <th className="px-3 py-3 font-medium">{text.counterparty}</th>
                  <th className="px-3 py-3 text-right font-medium">Importo</th>
                  <th className="px-3 py-3 font-medium">Stato</th>
                  <th className="px-3 py-3 font-medium">{text.paid}</th>
                  <th className="px-3 py-3 font-medium">
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const state = ledgerState(r, today);
                  const late = daysLate(r.dueDate, today);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-line-soft align-top last:border-0 ${
                        state === "OVERDUE" ? "bg-red-50/60" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
                        {formatDay(r.dueDate)}
                      </td>
                      <td className="max-w-[24rem] px-3 py-3">
                        <p className="font-medium text-ink">{r.counterparty}</p>
                        {r.description ? <p className="text-xs text-slate-600">{r.description}</p> : null}
                        {r.notes ? <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{r.notes}</p> : null}
                        {r.alertCount > 0 && !r.paidAt ? (
                          <p className="mt-1 font-mono text-[11px] text-red-700">
                            {r.alertCount} alert inviat{r.alertCount === 1 ? "o" : "i"}
                            {r.lastAlertAt ? ` · ultimo ${formatDay(r.lastAlertAt.toISOString().slice(0, 10))}` : ""}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
                        {formatEur(r.amountCents, r.currency)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}
                        >
                          {stateLabel(kind, state, late)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <LedgerPaidToggle
                          id={r.id}
                          kind={kind}
                          paidDate={ymdOfDay(r.paidAt)}
                          paidNote={r.paidNote}
                          today={today}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <LedgerEntryButton
                            kind={kind}
                            entry={{
                              id: r.id,
                              counterparty: r.counterparty,
                              description: r.description,
                              amountCents: r.amountCents,
                              dueDate: ymdOfDay(r.dueDate),
                              notes: r.notes,
                            }}
                          />
                          <LedgerDeleteButton id={r.id} label={r.counterparty} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas font-medium">
                  <td className="px-3 py-3 mono-label" colSpan={2}>
                    Totale filtrati ({rows.length})
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {formatEur(filteredTotal)}
                  </td>
                  <td className="px-3 py-3" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        In rosso le voci oltre la scadenza. Radar manda un alert a {LEDGER_ALERT_RECIPIENT} il giorno
        dopo la scadenza e poi ogni {LEDGER_ALERT_REPEAT_DAYS} giorni, finché non la segni come{" "}
        {text.paid.toLowerCase()}. Importi così come inseriti, senza calcolo IVA. Questa sezione non
        è collegata ad abbonamenti e pagamenti.
        {stato !== "tutti" ? (
          <>
            {" "}
            <Link href={`/amministrazione/${text.slug}${qs({ stato: "tutti" })}`} className="text-brand hover:underline">
              Mostra tutte
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
