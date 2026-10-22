import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatEur } from "@/lib/format";
import { formatRomeDate, romeYmd } from "@/lib/rome-time";
import {
  INVOICE_DUE_AFTER_DAYS,
  REFUND_STATE_LABELS,
  isInvoiceOverdue,
  needsCreditNote,
  paymentBreakdown,
  refundStateOf,
  sumBreakdowns,
  type RefundState,
} from "@/lib/payment-ledger";
import {
  INVOICED_FILTERS,
  PAYMENT_LIST_ORDER,
  PAYMENT_LIST_SELECT,
  PAYMENT_STATE_FILTERS,
  buildPaymentWhere,
  findAllPayments,
  parsePaymentFilters,
  paymentClientLabel,
  paymentServiceLabels,
  type PaymentFilters,
} from "@/lib/payments-list";
import { InvoicingToggle } from "./invoicing-toggle";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATE_STYLES: Record<RefundState, string> = {
  PAGATO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  STORNATO: "bg-red-50 text-red-700 border-red-200",
  STORNATO_PARZIALE: "bg-orange-50 text-orange-700 border-orange-200",
};

/** Querystring dei filtri (senza pagina 1), per paginazione ed export. */
function filterParams(f: PaymentFilters, overrides: Partial<PaymentFilters> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...overrides })) {
    if (v == null || v === "" || (k === "page" && v === 1)) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/** Giorno salvato a mezzanotte UTC → YYYY-MM-DD. */
const dayYmd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function PagamentiPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Sezione riservata agli amministratori.
      </p>
    );
  }

  const now = new Date();
  const today = romeYmd(now);
  const f = parsePaymentFilters(searchParams);
  const where = buildPaymentWhere(f, now);

  const [total, rows, all, clients] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: PAYMENT_LIST_ORDER,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: PAYMENT_LIST_SELECT,
    }),
    // Riga totali: calcolata su TUTTI i pagamenti filtrati, non solo la pagina.
    findAllPayments(where),
    prisma.client.findMany({
      select: { id: true, name: true, ragioneSociale: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const totals = sumBreakdowns(all.map(paymentBreakdown));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = filterParams(f);
  const clientLabel = (c: { name: string; ragioneSociale: string | null }) =>
    c.ragioneSociale?.trim() ? c.ragioneSociale : c.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pagamenti</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tutti gli incassi confermati, anche stornati, con lo stato di fatturazione.
          </p>
        </div>
        <a href={`/api/payments/export${qs ? `?${qs}` : ""}`} className="btn-ghost">
          Esporta CSV
        </a>
      </div>

      <form method="get" action="/pagamenti" className="card grid gap-3 p-4 sm:grid-cols-4">
        <label className="text-xs text-slate-500">
          Dal
          <input type="date" name="from" defaultValue={f.from ?? ""} className="field mt-1" />
        </label>
        <label className="text-xs text-slate-500">
          Al
          <input type="date" name="to" defaultValue={f.to ?? ""} className="field mt-1" />
        </label>
        <label className="text-xs text-slate-500">
          Cliente
          <select name="clientId" defaultValue={f.clientId ?? ""} className="field mt-1">
            <option value="">Tutti i clienti</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {clientLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Metodo
          <select name="method" defaultValue={f.method ?? ""} className="field mt-1">
            <option value="">Tutti i metodi</option>
            <option value="STRIPE">Carta</option>
            <option value="MANUALE">Manuale</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Stato
          <select name="state" defaultValue={f.state ?? ""} className="field mt-1">
            <option value="">Tutti gli stati</option>
            {Object.entries(PAYMENT_STATE_FILTERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Fatturazione
          <select name="invoiced" defaultValue={f.invoiced ?? ""} className="field mt-1">
            <option value="">Tutti</option>
            {Object.entries(INVOICED_FILTERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Cerca
          <input
            type="search"
            name="q"
            defaultValue={f.q ?? ""}
            placeholder="Cliente, cliente finale, n. fattura o ricevuta"
            className="field mt-1"
          />
        </label>
        <div className="flex gap-2 sm:col-span-4">
          <button type="submit" className="btn-primary">
            Filtra
          </button>
          <Link href="/pagamenti" className="btn-ghost">
            Azzera
          </Link>
        </div>
      </form>

      <p className="text-sm text-slate-500">
        {total} pagamenti · pagina {f.page} di {pages}
      </p>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessun pagamento corrisponde ai filtri.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[78rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-3 py-3 font-medium">Data</th>
                  <th className="px-3 py-3 font-medium">Cliente / servizi</th>
                  <th className="px-3 py-3 text-right font-medium">Imponibile</th>
                  <th className="px-3 py-3 text-right font-medium">IVA</th>
                  <th className="px-3 py-3 text-right font-medium">Comm.</th>
                  <th className="px-3 py-3 text-right font-medium">Incassato</th>
                  <th className="px-3 py-3 text-right font-medium">Rimborsato</th>
                  <th className="px-3 py-3 font-medium">Metodo</th>
                  <th className="px-3 py-3 font-medium">Ricevuta</th>
                  <th className="px-3 py-3 font-medium">Stato</th>
                  <th className="sticky right-0 bg-white px-3 py-3 font-medium shadow-[-1px_0_0_#e2e8f0]">Fatturato</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = paymentBreakdown(r);
                  const state = refundStateOf(r);
                  const overdue = isInvoiceOverdue(r, now);
                  const creditNoteDue = needsCreditNote(r);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-line-soft align-top last:border-0 ${
                        overdue ? "bg-amber-50" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
                        {r.paidAt ? formatRomeDate(r.paidAt) : "—"}
                      </td>
                      <td className="max-w-[20rem] px-3 py-3">
                        <Link
                          href={`/clienti/${r.subscription.client.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {paymentClientLabel(r)}
                        </Link>
                        <ul className="mt-0.5 text-xs text-slate-500">
                          {paymentServiceLabels(r).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                        <Link
                          href={`/abbonamenti/${r.subscriptionId}`}
                          className="text-xs text-brand hover:underline"
                        >
                          Abbonamento →
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        {formatEur(b.taxableCents, r.currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right text-slate-600">
                        {formatEur(b.vatCents, r.currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right text-slate-600">
                        {b.serviceFeeCents > 0 ? formatEur(b.serviceFeeCents, r.currency) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium">
                        {formatEur(b.collectedCents, r.currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right text-red-700">
                        {b.refundedCents > 0 ? `−${formatEur(b.refundedCents, r.currency)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {r.method === "STRIPE" ? "Carta" : "Manuale"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {r.receipt ? (
                          <a
                            href={`/r/${r.receipt.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-brand hover:underline"
                          >
                            {r.receipt.number}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}
                        >
                          {REFUND_STATE_LABELS[state]}
                        </span>
                      </td>
                      <td
                        className={`sticky right-0 px-3 py-3 shadow-[-1px_0_0_#e2e8f0] ${
                          overdue ? "bg-amber-50" : "bg-white"
                        }`}
                      >
                        <InvoicingToggle
                          paymentId={r.id}
                          target="invoice"
                          issued={!!r.invoicedAt}
                          number={r.invoiceNumber}
                          date={dayYmd(r.invoiceDate)}
                          today={today}
                        />
                        {overdue ? (
                          <span className="mt-1 inline-flex whitespace-nowrap rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Da fatturare
                          </span>
                        ) : null}
                        {creditNoteDue || r.creditNoteIssuedAt ? (
                          <div className="mt-2 border-t border-line-soft pt-2">
                            {creditNoteDue ? (
                              <span className="mb-1 inline-flex whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                                Nota di credito da emettere
                              </span>
                            ) : (
                              <p className="mb-1 text-xs text-slate-500">Nota di credito</p>
                            )}
                            <InvoicingToggle
                              paymentId={r.id}
                              target="creditNote"
                              issued={!!r.creditNoteIssuedAt}
                              number={r.creditNoteNumber}
                              date={dayYmd(r.creditNoteDate)}
                              today={today}
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas font-medium">
                  <td className="px-3 py-3 mono-label" colSpan={2}>
                    Totale filtrati ({total})
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {formatEur(totals.taxableCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {formatEur(totals.vatCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {formatEur(totals.serviceFeeCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {formatEur(totals.collectedCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-red-700">
                    {totals.refundedCents > 0 ? `−${formatEur(totals.refundedCents)}` : "—"}
                  </td>
                  <td className="px-3 py-3" colSpan={3} />
                  <td className="sticky right-0 bg-canvas px-3 py-3 shadow-[-1px_0_0_#e2e8f0]">
                    <span className="block text-xs font-normal text-slate-500">Netto incassato</span>
                    <span className="whitespace-nowrap font-semibold">{formatEur(totals.netCents)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        In giallo i pagamenti non fatturati da più di {INVOICE_DUE_AFTER_DAYS} giorni
        (l&apos;email di conferma promette la fattura entro 12 giorni lavorativi).
        Date in ora italiana.
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          {f.page > 1 ? (
            <Link href={`/pagamenti?${filterParams(f, { page: f.page - 1 })}`} className="btn-ghost">
              ← Precedenti
            </Link>
          ) : null}
          {f.page < pages ? (
            <Link href={`/pagamenti?${filterParams(f, { page: f.page + 1 })}`} className="btn-ghost">
              Successive →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
