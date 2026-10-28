import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatEur, formatDate } from "@/lib/format";
import { normalizeAddress } from "@/lib/address";
import { refundStateOf } from "@/lib/payment-ledger";
import { isReceiptPubliclyAccessible } from "@/lib/receipt-access";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { HtmlLang } from "@/components/html-lang";
import { langOf, tr, type Lang } from "@/lib/i18n";
import { ReceiptControls } from "./receipt-controls";
import "./receipt.css";

export const dynamic = "force-dynamic";

const LOGO_URL = "/logo-delta-solutions.png";

// Imposta lo stato "carta nella stampante" solo se JS è attivo: senza JS lo
// scontrino resta visibile (vedi receipt.css).
const JS_FLAG_SCRIPT =
  "document.currentScript.parentElement.classList.add('rcpt-js')";

function methodLabel(method: string, lang: Lang = "it"): string {
  return method === "STRIPE"
    ? tr(lang, { it: "Carta di credito", en: "Credit card" })
    : tr(lang, { it: "Pagamento manuale", en: "Manual payment" });
}

/** Timbro dallo stato del pagamento: storno totale, parziale o pagato. */
function stampFor(
  payment: Parameters<typeof refundStateOf>[0],
  lang: Lang = "it",
): {
  label: string;
  refunded: boolean;
} {
  const state = refundStateOf(payment);
  if (state === "STORNATO")
    return { label: tr(lang, { it: "STORNATO", en: "REFUNDED" }), refunded: true };
  if (state === "STORNATO_PARZIALE")
    return {
      label: tr(lang, { it: "STORNATO PARZ.", en: "PART. REFUNDED" }),
      refunded: true,
    };
  return { label: tr(lang, { it: "PAGATO", en: "PAID" }), refunded: false };
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
      payment: {
        select: {
          status: true,
          items: { select: { status: true } },
          subscription: { select: { client: { select: { locale: true } } } },
        },
      },
    },
  });
  if (!receipt) notFound();

  // Etichette nella lingua ATTUALE del cliente (le righe restano lo snapshot).
  const lang: Lang = langOf(receipt.payment.subscription.client.locale);

  const accessible = isReceiptPubliclyAccessible(receipt);

  // ── Link scaduto: nessun dato visibile (privacy per oscuramento) ───────────
  if (!accessible) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <HtmlLang lang={lang} />
        <div className="card p-8 text-center">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
            {tr(lang, { it: "Ricevuta", en: "Receipt" })} {receipt.number}
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            {tr(lang, {
              it: "Link non più disponibile",
              en: "Link no longer available",
            })}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {tr(lang, {
              it: "Questo link non è più disponibile. Per richiedere una nuova copia della ricevuta, scrivi a",
              en: "This link is no longer available. To request a new copy of the receipt, write to",
            })}{" "}
            <a
              href="mailto:hello@deltasolutions.agency"
              className="text-brand underline"
            >
              hello@deltasolutions.agency
            </a>{" "}
            {tr(lang, { it: "indicando il numero", en: "quoting the number" })}{" "}
            <span className="font-mono">{receipt.number}</span>.
          </p>
        </div>
      </main>
    );
  }

  // ── Codice fiscale / partita IVA: mostra quello presente ───────────────────
  const taxId = receipt.partitaIva
    ? { label: tr(lang, { it: "P. IVA", en: "VAT no." }), value: receipt.partitaIva }
    : receipt.codiceFiscale
      ? {
          label: tr(lang, { it: "Cod. fiscale", en: "Tax code" }),
          value: receipt.codiceFiscale,
        }
      : null;
  const company = receipt.ragioneSociale?.trim();
  // Snapshot salvato: ripulito anche per le ricevute emesse prima di formatAddress.
  const address = normalizeAddress(receipt.clientAddress);
  const stamp = stampFor(receipt.payment, lang);
  const cur = receipt.currency;

  return (
    <div className="rcpt-page" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG_SCRIPT }} />
      <HtmlLang lang={lang} />
      <main className="rcpt-main">
        <header className="rcpt-header">
          <div className="rcpt-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_URL} alt="Delta Solutions" />
            <span>RADAR</span>
          </div>
          <ReceiptControls lang={lang} />
        </header>

        <div className="rcpt-printer" aria-hidden="true">
          <div className="rcpt-printer-label">
            <span className="rcpt-led" />
            {tr(lang, {
              it: "RADAR · RICEVUTA DI PAGAMENTO",
              en: "RADAR · PAYMENT RECEIPT",
            })}
          </div>
          <div className="rcpt-slit" />
        </div>

        <div className="rcpt-slot">
          <div className="rcpt-feed">
            <article id="rcpt-paper" className="rcpt-paper" aria-label={`${tr(lang, { it: "Ricevuta", en: "Receipt" })} ${receipt.number}`}>
              <h1 className="rcpt-title">DELTA SOLUTIONS</h1>
              <p className="rcpt-subtitle">
                {tr(lang, { it: "Ricevuta non fiscale", en: "Non-fiscal receipt" })}
              </p>
              <p className="rcpt-meta">
                {receipt.number} · {formatDate(receipt.issuedAt, lang)}
              </p>

              <hr className="rcpt-sep" />

              <dl className="rcpt-fields">
                <dt>{tr(lang, { it: "Cliente", en: "Client" })}</dt>
                <dd>{company || receipt.clientName}</dd>
                {company ? (
                  <>
                    <dt>{tr(lang, { it: "Referente", en: "Contact" })}</dt>
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
                    <dt>{tr(lang, { it: "Indirizzo", en: "Address" })}</dt>
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
                      <span className="rcpt-amount">
                        {formatEur(line.amountCents, cur, lang)}
                      </span>
                    </div>
                    {line.endClientName ? (
                      <p className="rcpt-line-sub">
                        {tr(lang, { it: "Cliente finale", en: "End client" })}:{" "}
                        {line.endClientName}
                      </p>
                    ) : null}
                    {line.description?.trim() ? (
                      <p className="rcpt-line-sub">{line.description}</p>
                    ) : null}
                    {line.periodStart && line.periodEnd ? (
                      <p className="rcpt-line-sub">
                        {formatDate(line.periodStart, lang)} →{" "}
                        {formatDate(line.periodEnd, lang)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <hr className="rcpt-sep" />

              <div className="rcpt-row">
                <span>{tr(lang, { it: "Imponibile", en: "Taxable amount" })}</span>
                <span>{formatEur(receipt.taxableAmountCents, cur, lang)}</span>
              </div>
              <div className="rcpt-row">
                <span>{tr(lang, { it: "IVA 22%", en: "VAT 22%" })}</span>
                <span>{formatEur(receipt.vatAmountCents, cur, lang)}</span>
              </div>
              {receipt.serviceFeeCents > 0 ? (
                <div className="rcpt-row">
                  <span>
                    {tr(lang, {
                      it: "Commissione di servizio (1,5%)",
                      en: "Payment handling fee (1.5%)",
                    })}
                  </span>
                  <span>{formatEur(receipt.serviceFeeCents, cur, lang)}</span>
                </div>
              ) : null}

              <hr className="rcpt-sep" />

              <div className="rcpt-total">
                <span
                  className={`rcpt-stamp${stamp.refunded ? " rcpt-stamp-refunded" : ""}${stamp.label.length > 10 ? " rcpt-stamp-long" : ""}`}
                  aria-label={`${tr(lang, { it: "Stato", en: "Status" })}: ${stamp.label}`}
                >
                  {stamp.label}
                </span>
                <p className="rcpt-total-label">
                  {tr(lang, { it: "TOTALE PAGATO", en: "TOTAL PAID" })}
                </p>
                <p className="rcpt-total-amount">
                  {formatEur(receipt.amountCents, cur, lang)}
                </p>
              </div>

              <hr className="rcpt-sep" />

              <dl className="rcpt-fields">
                <dt>{tr(lang, { it: "Metodo", en: "Method" })}</dt>
                <dd>{methodLabel(receipt.method, lang)}</dd>
                <dt>{tr(lang, { it: "Data pag.", en: "Paid on" })}</dt>
                <dd>{formatDate(receipt.paidAt, lang)}</dd>
              </dl>

              <hr className="rcpt-sep" />

              <div className="rcpt-barcode" aria-hidden="true" />
              <p className="rcpt-footnote">
                {tr(lang, {
                  it: "Documento senza valore fiscale",
                  en: "Document with no fiscal value",
                })}{" "}
                · hello@deltasolutions.agency
              </p>
            </article>
          </div>
        </div>

        {/* Invito recensione: fuori dal documento, nascosto in stampa. */}
        <div className="rcpt-review">
          <GoogleReviewCta
            variant="subtle"
            lang={lang}
            title={tr(lang, {
              it: "Ti è piaciuto il nostro servizio?",
              en: "Did you enjoy our service?",
            })}
            description={tr(lang, {
              it: "Se ti trovi bene con Delta Solutions, lasciarci una recensione ci aiuta tantissimo. Grazie!",
              en: "If you're happy with Delta Solutions, leaving us a review helps us enormously. Thank you!",
            })}
          />
        </div>
      </main>
    </div>
  );
}
