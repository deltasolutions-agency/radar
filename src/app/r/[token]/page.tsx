import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatEur, formatDate } from "@/lib/format";
import { isReceiptPubliclyAccessible } from "@/lib/receipt-access";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function methodLabel(method: string): string {
  return method === "STRIPE" ? "Carta di credito" : "Pagamento manuale";
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 font-mono text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

export default async function RicevutaPubblicaPage({
  params,
}: {
  params: { token: string };
}) {
  const receipt = await prisma.receipt.findUnique({
    where: { token: params.token },
    include: { lines: true },
  });
  if (!receipt) notFound();

  const accessible = isReceiptPubliclyAccessible(receipt);

  // ── Link scaduto: nessun dato visibile (privacy per oscuramento) ───────────
  if (!accessible) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <div className="card p-8 text-center">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
            Ricevuta {receipt.number}
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            Link non più disponibile
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Questo link non è più disponibile. Per richiedere una nuova copia
            della ricevuta, scrivi a{" "}
            <a
              href="mailto:hello@deltasolutions.agency"
              className="text-brand underline"
            >
              hello@deltasolutions.agency
            </a>{" "}
            indicando il numero{" "}
            <span className="font-mono">{receipt.number}</span>.
          </p>
        </div>
      </main>
    );
  }

  // ── Codice fiscale / partita IVA: mostra quello presente ───────────────────
  const taxId = receipt.partitaIva
    ? { label: "Partita IVA", value: receipt.partitaIva }
    : receipt.codiceFiscale
      ? { label: "Codice fiscale", value: receipt.codiceFiscale }
      : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 print:py-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <article className="card p-8 print:border-0 print:shadow-none">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Ricevuta non fiscale
            </h1>
            <p className="mt-1 font-mono text-sm text-slate-600">
              {receipt.number}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
              Data emissione
            </p>
            <p className="font-mono text-sm text-ink">
              {formatDate(receipt.issuedAt)}
            </p>
          </div>
        </header>

        {/* Cliente */}
        <section className="border-b border-line-soft py-5">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-slate-500">
            Cliente
          </h2>
          <dl>
            <Field
              label="Denominazione"
              value={receipt.ragioneSociale?.trim() || receipt.clientName}
            />
            {receipt.ragioneSociale?.trim() ? (
              <Field label="Referente" value={receipt.clientName} />
            ) : null}
            {taxId ? <Field label={taxId.label} value={taxId.value} /> : null}
            {receipt.clientAddress ? (
              <Field label="Indirizzo" value={receipt.clientAddress} />
            ) : null}
            {receipt.clientEmail ? (
              <Field label="Email" value={receipt.clientEmail} />
            ) : null}
          </dl>
        </section>

        {/* Servizi */}
        <section className="border-b border-line-soft py-5">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-slate-500">
            {receipt.lines.length === 1 ? "Servizio" : "Servizi"}
          </h2>
          <div className="space-y-2">
            {receipt.lines.map((line) => {
              const linePeriod =
                line.periodStart && line.periodEnd
                  ? `${formatDate(line.periodStart)} → ${formatDate(line.periodEnd)}`
                  : null;
              return (
                <div
                  key={line.id}
                  className="flex items-start justify-between gap-4 border-b border-line-soft pb-2 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm text-ink">
                      {line.serviceName}
                      {line.quantity > 1 ? (
                        <span className="text-slate-500"> ×{line.quantity}</span>
                      ) : null}
                    </p>
                    {line.description?.trim() ? (
                      <p className="text-xs text-slate-500">
                        {line.description}
                      </p>
                    ) : null}
                    {linePeriod ? (
                      <p className="font-mono text-xs text-slate-500">
                        {linePeriod}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 font-mono text-sm text-ink">
                    {formatEur(line.amountCents, receipt.currency)}
                  </p>
                </div>
              );
            })}

            {receipt.serviceFeeCents > 0 ? (
              <div className="flex items-start justify-between gap-4 border-b border-line-soft pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm text-ink">Costi di servizio</p>
                  <p className="text-xs text-slate-500">
                    Commissione di gestione pagamento (1,5%)
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm text-ink">
                  {formatEur(receipt.serviceFeeCents, receipt.currency)}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {/* Pagamento */}
        <section className="py-5">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-slate-500">
            Pagamento
          </h2>
          <dl>
            <Field label="Metodo" value={methodLabel(receipt.method)} />
            <Field
              label="Data pagamento"
              value={
                <span className="font-mono">{formatDate(receipt.paidAt)}</span>
              }
            />
            <Field
              label="Imponibile"
              value={
                <span className="font-mono">
                  {formatEur(receipt.taxableAmountCents, receipt.currency)}
                </span>
              }
            />
            <Field
              label="IVA 22%"
              value={
                <span className="font-mono">
                  {formatEur(receipt.vatAmountCents, receipt.currency)}
                </span>
              }
            />
            <Field
              label="Totale pagato"
              value={
                <span className="font-mono text-lg font-semibold text-ink">
                  {formatEur(receipt.amountCents, receipt.currency)}
                </span>
              }
            />
          </dl>
        </section>

        {/* Footer */}
        <footer className="mt-2 border-t border-line pt-5 text-center">
          <p className="text-sm font-medium text-ink">Radar — Delta Solutions</p>
          <p className="mt-1 text-xs text-slate-500">
            Questo documento non ha valore fiscale
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Per informazioni: hello@deltasolutions.agency
          </p>
        </footer>
      </article>

      {/* Invito recensione: fuori dal documento fiscale, nascosto in stampa. */}
      <div className="mt-6">
        <GoogleReviewCta
          variant="subtle"
          title="Ti è piaciuto il nostro servizio?"
          description="Se ti trovi bene con Delta Solutions, lasciarci una recensione ci aiuta tantissimo. Grazie!"
        />
      </div>
    </main>
  );
}
