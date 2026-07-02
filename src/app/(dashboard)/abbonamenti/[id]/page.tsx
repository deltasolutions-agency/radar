import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  SubscriptionStatusBadge,
  PaymentStatusBadge,
} from "@/components/badges";
import { DeleteButton } from "@/components/delete-button";
import { CeaseButton } from "../cease-button";
import { PaymentActions } from "../payment-actions";
import { ReactivateButton } from "../reactivate-button";
import { RegenerateLinkButton } from "../regenerate-link-button";
import {
  isReceiptPubliclyAccessible,
  getReceiptExpiryDate,
} from "@/lib/receipt-access";
import { formatEur, formatDate } from "@/lib/format";
import {
  BILLING_PERIOD_LABELS,
  PAYMENT_METHOD_LABELS,
  type SubscriptionStatusValue,
  type BillingPeriodValue,
  type PaymentMethodValue,
  type PaymentStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="mono-label w-40 shrink-0 sm:pt-0.5">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

export default async function AbbonamentoDettaglioPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { payment?: string };
}) {
  const sub = await prisma.subscription.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      service: true,
      payments: {
        include: { receipt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!sub) notFound();

  const status = sub.status as SubscriptionStatusValue;
  const hasPayments = sub.payments.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/abbonamenti"
          className="text-sm text-slate-500 hover:underline"
        >
          ← Abbonamenti
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {sub.client.ragioneSociale?.trim()
                ? sub.client.ragioneSociale
                : sub.client.name}
            </h1>
            <SubscriptionStatusBadge status={status} />
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/abbonamenti/${sub.id}/modifica`} className="btn-ghost">
              Modifica
            </Link>
            {!hasPayments ? (
              <DeleteButton
                endpoint={`/api/subscriptions/${sub.id}`}
                redirectTo="/abbonamenti"
                entityLabel="questo abbonamento"
              />
            ) : null}
          </div>
        </div>
      </div>

      {searchParams.payment === "success" ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Pagamento completato con successo. La ricevuta è disponibile nello
          storico qui sotto.
        </p>
      ) : null}
      {searchParams.payment === "cancelled" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pagamento annullato. Nessun addebito è stato effettuato.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mono-label mb-3">Dati abbonamento</h2>
          <dl>
            <Row
              label="Cliente"
              value={
                <Link
                  href={`/clienti/${sub.clientId}`}
                  className="text-brand hover:underline"
                >
                  {sub.client.name}
                </Link>
              }
            />
            <Row
              label="Servizio"
              value={
                <Link
                  href={`/servizi/${sub.serviceId}`}
                  className="text-brand hover:underline"
                >
                  {sub.service.name}
                </Link>
              }
            />
            <Row
              label="Periodo"
              value={`${formatDate(sub.startDate)} → ${formatDate(sub.endDate)}`}
            />
            <Row
              label="Prezzo"
              value={formatEur(sub.priceCents, sub.currency)}
            />
            <Row
              label="Periodicità"
              value={
                BILLING_PERIOD_LABELS[sub.billingPeriod as BillingPeriodValue] +
                (sub.billingPeriod === "PERSONALIZZATA" && sub.customPeriodDays
                  ? ` (${sub.customPeriodDays} giorni)`
                  : "")
              }
            />
            <Row
              label="Metodo"
              value={
                PAYMENT_METHOD_LABELS[sub.paymentMethod as PaymentMethodValue]
              }
            />
            <Row label="Rinnovo auto" value={sub.autoRenew ? "Sì" : "No"} />
            <Row label="Note" value={sub.note?.trim() ? sub.note : "—"} />
          </dl>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="mono-label">Azioni</h2>
          <PaymentActions
            subscriptionId={sub.id}
            paymentMethod={sub.paymentMethod}
            defaultAmountEuro={(sub.priceCents / 100).toFixed(2)}
          />
          <div className="border-t border-line-soft pt-4">
            <CeaseButton id={sub.id} status={sub.status} />
          </div>
        </section>
      </div>

      <section className="card overflow-hidden">
        <h2 className="mono-label px-5 pt-5">Storico pagamenti</h2>
        {sub.payments.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            Nessun pagamento registrato.
          </div>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left mono-label">
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium">Importo</th>
                <th className="px-5 py-3 font-medium">Metodo</th>
                <th className="px-5 py-3 font-medium">Stato</th>
                <th className="px-5 py-3 font-medium">Ricevuta</th>
              </tr>
            </thead>
            <tbody>
              {sub.payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-line-soft last:border-0"
                >
                  <td className="px-5 py-3 text-slate-600">
                    {p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {formatEur(p.amountCents, p.currency)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethodValue]}
                      {p.note?.trim() ? (
                        <span
                          title={p.note}
                          aria-label={`Nota: ${p.note}`}
                          className="cursor-help text-slate-400"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <PaymentStatusBadge
                      status={p.status as PaymentStatusValue}
                    />
                  </td>
                  <td className="px-5 py-3">
                    {p.receipt ? (
                      isReceiptPubliclyAccessible(p.receipt) ? (
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/r/${p.receipt.token}`}
                            className="text-brand hover:underline"
                            target="_blank"
                          >
                            {p.receipt.number}
                          </Link>
                          <span className="text-xs text-slate-400">
                            scade il {formatDate(getReceiptExpiryDate(p.receipt))}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-slate-500">
                            {p.receipt.number} · Link scaduto
                          </span>
                          <ReactivateButton receiptId={p.receipt.id} />
                        </div>
                      )
                    ) : p.status === "CONFERMATO" ? (
                      <span className="text-xs text-slate-500">
                        Ricevuta in generazione — ricarica tra qualche istante
                      </span>
                    ) : p.status === "IN_ATTESA" && p.method === "STRIPE" ? (
                      p.checkoutExpiresAt &&
                      p.checkoutExpiresAt.getTime() > Date.now() ? (
                        <span className="text-xs text-slate-500">
                          Link inviato, in attesa di pagamento
                          <br />
                          (scade il {formatDate(p.checkoutExpiresAt)})
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-slate-500">
                            Link scaduto
                          </span>
                          <RegenerateLinkButton paymentId={p.id} />
                        </div>
                      )
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="font-mono text-xs text-slate-400">
        id {sub.id} · creato {formatDate(sub.createdAt)}
      </p>
    </div>
  );
}
