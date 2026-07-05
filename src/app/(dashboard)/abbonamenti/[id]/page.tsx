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
import { RefundButton } from "../refund-button";
import { PaymentDeleteButton } from "../payment-delete-button";
import { AutoChargeRequestPanel } from "../auto-charge-request-panel";
import { AutoChargeItemBadge } from "../auto-charge-item-badge";
import { ServiceFeeToggle } from "../service-fee-toggle";
import { ForceDeleteSection } from "../force-delete-section";
import { paymentDeleteConfirmText } from "@/lib/payment-delete";
import {
  isReceiptPubliclyAccessible,
  getReceiptExpiryDate,
} from "@/lib/receipt-access";
import { formatEur, formatDate } from "@/lib/format";
import {
  formatBillingPeriod,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type SubscriptionStatusValue,
  type BillingPeriodValue,
  type PaymentMethodValue,
  type PaymentStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function AbbonamentoDettaglioPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { payment?: string; setup?: string };
}) {
  const sub = await prisma.subscription.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      items: {
        include: {
          service: true,
          _count: { select: { paymentItems: true } },
        },
        orderBy: { endDate: "asc" },
      },
      payments: {
        include: {
          receipt: true,
          items: {
            include: { subscriptionItem: { include: { service: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!sub) notFound();

  const clientName = sub.client.ragioneSociale?.trim()
    ? sub.client.ragioneSociale
    : sub.client.name;
  const hasPayments = sub.payments.length > 0;

  // Servizi idonei alla richiesta di attivazione (non cessati/sospesi e non già
  // in rinnovo automatico): l'admin ne sceglie un sottoinsieme esplicito.
  const selectableAutoChargeItems = sub.items
    .filter(
      (it) =>
        it.status !== "CESSATO" &&
        it.status !== "SOSPESO" &&
        !it.autoChargeEnabled,
    )
    .map((it) => ({
      id: it.id,
      serviceName:
        it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
      priceLabel: formatEur(it.priceCents * it.quantity, it.currency),
      periodicityLabel: formatBillingPeriod(
        it.billingPeriod as BillingPeriodValue,
        it.customPeriodDays,
      ),
    }));

  // Righe pagabili (non cessate) per il pannello pagamento.
  const payableItems = sub.items
    .filter((it) => it.status !== "CESSATO")
    .map((it) => ({
      id: it.id,
      serviceName: it.service.name,
      priceCents: it.priceCents,
      quantity: it.quantity,
      currency: it.currency,
      status: it.status,
      endDate: it.endDate.toISOString().slice(0, 10),
    }));

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
          <h1 className="text-2xl font-semibold tracking-tight">
            {clientName}
          </h1>
          <div className="flex items-center gap-2">
            <Link href={`/abbonamenti/${sub.id}/modifica`} className="btn-ghost">
              Modifica note
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
      {searchParams.setup === "success" ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Carta registrata. La conferma può richiedere qualche istante: ricarica
          la pagina se il rinnovo automatico non risulta ancora attivabile.
        </p>
      ) : null}
      {searchParams.setup === "cancelled" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Registrazione carta annullata.
        </p>
      ) : null}

      {/* Contenitore: cliente + note */}
      <section className="card p-6">
        <h2 className="mono-label mb-3">Abbonamento</h2>
        <dl>
          <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 sm:flex-row sm:gap-4">
            <dt className="mono-label w-40 shrink-0 sm:pt-0.5">Cliente</dt>
            <dd className="text-sm text-ink">
              <Link
                href={`/clienti/${sub.clientId}`}
                className="text-brand hover:underline"
              >
                {sub.client.name}
              </Link>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 sm:flex-row sm:gap-4">
            <dt className="mono-label w-40 shrink-0 sm:pt-0.5">Note</dt>
            <dd className="text-sm text-ink">
              {sub.notes?.trim() ? sub.notes : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
            <dt className="mono-label w-40 shrink-0 sm:pt-0.5">
              Costi di servizio (1,5%)
            </dt>
            <dd className="text-sm text-ink">
              <ServiceFeeToggle
                subscriptionId={sub.id}
                initialEnabled={sub.serviceFeeEnabled}
              />
            </dd>
          </div>
        </dl>
      </section>

      {/* Righe di servizio */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="mono-label">
            Servizi ({sub.items.length})
          </h2>
          <Link
            href={`/abbonamenti/${sub.id}/righe/nuovo`}
            className="btn-ghost text-sm"
          >
            + Aggiungi servizio
          </Link>
        </div>

        {sub.items.length > 0 ? (
          <div className="card space-y-3 p-6">
            <h3 className="mono-label">Rinnovo automatico</h3>
            <AutoChargeRequestPanel
              subscriptionId={sub.id}
              items={selectableAutoChargeItems}
            />
          </div>
        ) : null}

        {sub.items.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-slate-500">
            Nessun servizio in questo abbonamento.{" "}
            <Link
              href={`/abbonamenti/${sub.id}/righe/nuovo`}
              className="text-brand underline"
            >
              Aggiungine uno
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-4">
            {sub.items.map((it) => (
              <div key={it.id} className="card space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/servizi/${it.serviceId}`}
                      className="text-base font-medium text-ink hover:underline"
                    >
                      {it.service.name}
                    </Link>
                    <SubscriptionStatusBadge
                      status={it.status as SubscriptionStatusValue}
                    />
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Link
                      href={`/abbonamenti/${sub.id}/righe/${it.id}/modifica`}
                      className="text-brand hover:underline"
                    >
                      Modifica
                    </Link>
                    <CeaseButton
                      itemId={it.id}
                      status={it.status}
                      className="text-slate-600 hover:underline"
                    />
                    {it._count.paymentItems === 0 ? (
                      <DeleteButton
                        endpoint={`/api/subscription-items/${it.id}`}
                        redirectTo={`/abbonamenti/${sub.id}`}
                        entityLabel="questa riga di servizio"
                        className="text-red-600 hover:underline"
                      />
                    ) : null}
                  </div>
                </div>

                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <div className="flex gap-2 text-sm">
                    <dt className="mono-label w-28 shrink-0">Periodo</dt>
                    <dd className="text-ink">
                      {formatDate(it.startDate)} → {formatDate(it.endDate)}
                    </dd>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <dt className="mono-label w-28 shrink-0">Prezzo</dt>
                    <dd className="text-ink">
                      {it.quantity > 1 ? (
                        <>
                          {formatEur(it.priceCents, it.currency)}{" "}
                          <span className="text-slate-500">× {it.quantity} =</span>{" "}
                          <span className="font-medium">
                            {formatEur(it.priceCents * it.quantity, it.currency)}
                          </span>
                        </>
                      ) : (
                        formatEur(it.priceCents, it.currency)
                      )}
                    </dd>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <dt className="mono-label w-28 shrink-0">Periodicità</dt>
                    <dd className="text-ink">
                      {formatBillingPeriod(
                        it.billingPeriod as BillingPeriodValue,
                        it.customPeriodDays,
                      )}
                    </dd>
                  </div>
                  {it.notes?.trim() ? (
                    <div className="flex gap-2 text-sm">
                      <dt className="mono-label w-28 shrink-0">Note</dt>
                      <dd className="text-ink">{it.notes}</dd>
                    </div>
                  ) : null}
                </dl>

                {it.autoChargeEnabled ? (
                  <div className="border-t border-line-soft pt-4">
                    <AutoChargeItemBadge
                      itemId={it.id}
                      periodicityLabel={formatBillingPeriod(
                        it.billingPeriod as BillingPeriodValue,
                        it.customPeriodDays,
                      )}
                      autoChargeEndDateLabel={
                        it.autoChargeEndDate
                          ? formatDate(it.autoChargeEndDate)
                          : null
                      }
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Registrazione pagamento (righe raggruppate) */}
      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Registra pagamento</h2>
        <PaymentActions
          subscriptionId={sub.id}
          items={payableItems}
          serviceFeeEnabled={sub.serviceFeeEnabled}
        />
      </section>

      {/* Storico pagamenti */}
      <section className="card overflow-hidden">
        <h2 className="mono-label px-5 pt-5">Storico pagamenti</h2>
        {sub.payments.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            Nessun pagamento registrato.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left mono-label">
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium">Servizi</th>
                <th className="px-5 py-3 font-medium">Importo</th>
                <th className="px-5 py-3 font-medium">Metodo</th>
                <th className="px-5 py-3 font-medium">Stato</th>
                <th className="px-5 py-3 font-medium">Ricevuta</th>
              </tr>
            </thead>
            <tbody>
              {sub.payments.map((p) => {
                const refundable = p.items.filter(
                  (pi) => pi.status === "CONFERMATO",
                );
                return (
                  <tr
                    key={p.id}
                    className="border-b border-line-soft align-top last:border-0"
                  >
                    <td className="px-5 py-3 text-slate-600">
                      {p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      <ul className="space-y-0.5">
                        {p.items.map((pi) => {
                          const refunded = pi.status === "RIMBORSATO";
                          return (
                            <li
                              key={pi.id}
                              className="flex items-center gap-1.5"
                            >
                              <span className={refunded ? "text-slate-400" : ""}>
                                {pi.subscriptionItem.service.name}
                              </span>
                              <span
                                className={
                                  refunded
                                    ? "text-xs font-medium text-violet-600"
                                    : "text-xs text-slate-400"
                                }
                              >
                                {refunded
                                  ? "· rimborsato"
                                  : `· ${PAYMENT_STATUS_LABELS[
                                      pi.status as PaymentStatusValue
                                    ].toLowerCase()}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
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
                      <div className="flex flex-col items-start gap-1.5">
                        <PaymentStatusBadge
                          status={p.status as PaymentStatusValue}
                        />
                        {p.method === "STRIPE" && refundable.length > 0 ? (
                          <RefundButton
                            paymentId={p.id}
                            items={refundable.map((pi) => ({
                              id: pi.id,
                              serviceName: pi.subscriptionItem.service.name,
                              amountCents: pi.amountCents,
                              currency: p.currency,
                              previousEndDateLabel: pi.previousEndDate
                                ? formatDate(pi.previousEndDate)
                                : null,
                            }))}
                          />
                        ) : null}
                        <PaymentDeleteButton
                          paymentId={p.id}
                          expectedText={paymentDeleteConfirmText(p)}
                        />
                      </div>
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
                              scade il{" "}
                              {formatDate(getReceiptExpiryDate(p.receipt))}
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
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <p className="font-mono text-xs text-slate-400">
        id {sub.id} · creato {formatDate(sub.createdAt)}
      </p>

      {hasPayments ? (
        <ForceDeleteSection
          subscriptionId={sub.id}
          expectedText={clientName}
        />
      ) : null}
    </div>
  );
}
