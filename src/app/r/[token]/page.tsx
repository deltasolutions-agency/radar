import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatEur, formatDate } from "@/lib/format";
import { normalizeAddress } from "@/lib/address";
import { refundStateOf } from "@/lib/payment-ledger";
import { isReceiptPubliclyAccessible } from "@/lib/receipt-access";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { ReceiptControls } from "./receipt-controls";
import "./receipt.css";

export const dynamic = "force-dynamic";

const LOGO_URL = "/logo-delta-solutions.png";

// Imposta lo stato "carta nella stampante" solo se JS è attivo: senza JS lo
// scontrino resta visibile (vedi receipt.css).
const JS_FLAG_SCRIPT =
  "document.currentScript.parentElement.classList.add('rcpt-js')";

function methodLabel(method: string): string {
  return method === "STRIPE" ? "Carta di credito" : "Pagamento manuale";
}

/** Timbro dallo stato del pagamento: storno totale, parziale o pagato. */
function stampFor(payment: Parameters<typeof refundStateOf>[0]): {
  label: string;
  refunded: boolean;
} {
  const state = refundStateOf(payment);
  if (state === "STORNATO") return { label: "STORNATO", refunded: true };
  if (state === "STORNATO_PARZIALE") return { label: "STORNATO PARZ.", refunded: true };
  return { label: "PAGATO", refunded: false };
}

export default async function RicevutaPubblicaPage({
  params,
}: {
  params: { token: string };
}) {
  const receipt = await prisma.receipt.findUnique({
    where: { token: params.token },
    include: {
      lines: true,
      payment: { select: { status: true, items: { select: { status: true } } } },
    },
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
    ? { label: "P. IVA", value: receipt.partitaIva }
    : receipt.codiceFiscale
      ? { label: "Cod. fiscale", value: receipt.codiceFiscale }
      : null;
  const company = receipt.ragioneSociale?.trim();
  // Snapshot salvato: ripulito anche per le ricevute emesse prima di formatAddress.
  const address = normalizeAddress(receipt.clientAddress);
  const stamp = stampFor(receipt.payment);
  const cur = receipt.currency;

  return (
    <div className="rcpt-page" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG_SCRIPT }} />
      <main className="rcpt-main">
        <header className="rcpt-header">
          <div className="rcpt-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_URL} alt="Delta Solutions" />
            <span>RADAR</span>
          </div>
          <ReceiptControls />
        </header>

        <div className="rcpt-printer" aria-hidden="true">
          <div className="rcpt-printer-label">
            <span className="rcpt-led" />
            RADAR · RICEVUTA DI PAGAMENTO
          </div>
          <div className="rcpt-slit" />
        </div>

        <div className="rcpt-slot">
          <div className="rcpt-feed">
            <article id="rcpt-paper" className="rcpt-paper" aria-label={`Ricevuta ${receipt.number}`}>
              <h1 className="rcpt-title">DELTA SOLUTIONS</h1>
              <p className="rcpt-subtitle">Ricevuta non fiscale</p>
              <p className="rcpt-meta">
                {receipt.number} · {formatDate(receipt.issuedAt)}
              </p>

              <hr className="rcpt-sep" />

              <dl className="rcpt-fields">
                <dt>Cliente</dt>
                <dd>{company || receipt.clientName}</dd>
                {company ? (
                  <>
                    <dt>Referente</dt>
                    <dd>{receipt.clientName}</dd>
                  </>
                ) : null}
                {taxId ? (
                  <>
                    <dt>{taxId.label}</dt>
                    <dd>{taxId.value}</dd>
                  </>
                ) : null}
                {address ? (
                  <>
                    <dt>Indirizzo</dt>
                    <dd>{address}</dd>
                  </>
                ) : null}
                {receipt.clientEmail ? (
                  <>
                    <dt>Email</dt>
                    <dd>{receipt.clientEmail}</dd>
                  </>
                ) : null}
              </dl>

              <hr className="rcpt-sep" />

              {/* Righe al NETTO (imponibile). */}
              <div>
                {receipt.lines.map((line) => (
                  <div key={line.id} className="rcpt-line">
                    <div className="rcpt-line-head">
                      <span className="rcpt-line-name">
                        {line.serviceName}
                        {line.quantity > 1 ? ` ×${line.quantity}` : ""}
                      </span>
                      <span className="rcpt-dots" aria-hidden="true" />
                      <span className="rcpt-amount">{formatEur(line.amountCents, cur)}</span>
                    </div>
                    {line.endClientName ? (
                      <p className="rcpt-line-sub">Cliente finale: {line.endClientName}</p>
                    ) : null}
                    {line.description?.trim() ? (
                      <p className="rcpt-line-sub">{line.description}</p>
                    ) : null}
                    {line.periodStart && line.periodEnd ? (
                      <p className="rcpt-line-sub">
                        {formatDate(line.periodStart)} → {formatDate(line.periodEnd)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <hr className="rcpt-sep" />

              <div className="rcpt-row">
                <span>Imponibile</span>
                <span>{formatEur(receipt.taxableAmountCents, cur)}</span>
              </div>
              <div className="rcpt-row">
                <span>IVA 22%</span>
                <span>{formatEur(receipt.vatAmountCents, cur)}</span>
              </div>
              {receipt.serviceFeeCents > 0 ? (
                <div className="rcpt-row">
                  <span>Commissione di servizio (1,5%)</span>
                  <span>{formatEur(receipt.serviceFeeCents, cur)}</span>
                </div>
              ) : null}

              <hr className="rcpt-sep" />

              <div className="rcpt-total">
                <span
                  className={`rcpt-stamp${stamp.refunded ? " rcpt-stamp-refunded" : ""}${stamp.label.length > 10 ? " rcpt-stamp-long" : ""}`}
                  aria-label={`Stato: ${stamp.label}`}
                >
                  {stamp.label}
                </span>
                <p className="rcpt-total-label">TOTALE PAGATO</p>
                <p className="rcpt-total-amount">{formatEur(receipt.amountCents, cur)}</p>
              </div>

              <hr className="rcpt-sep" />

              <dl className="rcpt-fields">
                <dt>Metodo</dt>
                <dd>{methodLabel(receipt.method)}</dd>
                <dt>Data pag.</dt>
                <dd>{formatDate(receipt.paidAt)}</dd>
              </dl>

              <hr className="rcpt-sep" />

              <div className="rcpt-barcode" aria-hidden="true" />
              <p className="rcpt-footnote">
                Documento senza valore fiscale · hello@deltasolutions.agency
              </p>
            </article>
          </div>
        </div>

        {/* Invito recensione: fuori dal documento, nascosto in stampa. */}
        <div className="rcpt-review">
          <GoogleReviewCta
            variant="subtle"
            title="Ti è piaciuto il nostro servizio?"
            description="Se ti trovi bene con Delta Solutions, lasciarci una recensione ci aiuta tantissimo. Grazie!"
          />
        </div>
      </main>
    </div>
  );
}
