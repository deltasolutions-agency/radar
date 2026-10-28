import { prisma } from "@/lib/prisma";
import { EXAMPLE_TOKEN } from "@/lib/example-link";
import { canRegenerateCheckout } from "@/lib/payment-checkout";
import { EndClientLabel } from "@/components/end-client-label";
import { formatEur, formatDate } from "@/lib/format";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { splitVatFromGross } from "@/lib/vat";
import { langOf, localizedServiceName, tr, type Lang } from "@/lib/i18n";
import { HtmlLang } from "@/components/html-lang";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "/logo-delta-solutions.png";

function Shell({
  children,
  lang = "it",
}: {
  children: React.ReactNode;
  lang?: Lang;
}) {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <HtmlLang lang={lang} />
      <div className="mb-6 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Delta Solutions" className="h-7 w-auto" />
        <span className="mono-label">Radar</span>
      </div>
      <div className="card p-8">{children}</div>
    </main>
  );
}

function Message({
  title,
  body,
  lang = "it",
}: {
  title: string;
  body: string;
  lang?: Lang;
}) {
  return (
    <Shell lang={lang}>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </Shell>
  );
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string };
}) {
  // Link fittizio dell'email di test: nessun pagamento/richiesta reale.
  if (params.token === EXAMPLE_TOKEN) {
    return (
      <Message
        title="Link di esempio"
        body="Questo è il link di prova dell'email di test: nei reminder reali porta alla pagina di pagamento del cliente."
      />
    );
  }

  const payment = await prisma.payment.findUnique({
    where: { payToken: params.token },
    include: {
      subscription: { include: { client: true } },
      items: {
        include: { subscriptionItem: { include: { service: true } } },
      },
    },
  });

  // Link scaduto ma rigenerabile (stesso pagamento, stessi importi): la pagina
  // resta utilizzabile e la nuova sessione Stripe viene creata al click.
  const expired =
    !!payment?.checkoutExpiresAt &&
    payment.checkoutExpiresAt.getTime() < Date.now();
  const regenerable =
    !!payment && expired && (await canRegenerateCheckout(payment.id));

  // Lingua del cliente (se il pagamento esiste), altrimenti italiano.
  const lang: Lang = langOf(payment?.subscription.client.locale);

  if (!payment || (payment.status !== "IN_ATTESA" && !regenerable)) {
    return (
      <Message
        lang={lang}
        title={tr(lang, { it: "Link non valido", en: "Invalid link" })}
        body={tr(lang, {
          it: "Link non valido o pagamento già gestito.",
          en: "This link is invalid or the payment has already been processed.",
        })}
      />
    );
  }

  if (expired && !regenerable) {
    return (
      <Message
        lang={lang}
        title={tr(lang, { it: "Link scaduto", en: "Link expired" })}
        body={tr(lang, {
          it: "Link scaduto, contatta hello@deltasolutions.agency.",
          en: "This link has expired, please contact hello@deltasolutions.agency.",
        })}
      />
    );
  }

  const client = payment.subscription.client;

  // PaymentItem.amountCents è il LORDO: scorporo per riga per mostrare le righe
  // al netto e il riepilogo Imponibile/IVA (Σ righe === imponibile).
  let taxableCents = 0;
  let vatCents = 0;
  for (const pi of payment.items) {
    const s = splitVatFromGross(pi.amountCents);
    taxableCents += s.taxableCents;
    vatCents += s.vatCents;
  }

  const existingConsent = await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  });
  const needsConsent = !existingConsent;

  // Il checkbox "attiva rinnovo automatico" ha senso solo se NESSUNA delle righe
  // pagate ha già il rinnovo automatico attivo.
  const canActivateAutoCharge = payment.items.every(
    (pi) => !pi.subscriptionItem.autoChargeEnabled,
  );

  return (
    <Shell lang={lang}>
      <h1 className="text-lg font-semibold tracking-tight">
        {payment.kind === "ACTIVATION"
          ? tr(lang, {
              it: "Attivazione abbonamento · primo pagamento",
              en: "Subscription activation · first payment",
            })
          : tr(lang, { it: "Pagamento abbonamento", en: "Subscription payment" })}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <dl className="mt-5 space-y-3 border-y border-line-soft py-4 text-sm">
        {payment.items.map((pi) => {
          const period =
            pi.periodStart && pi.periodEnd
              ? `${formatDate(pi.periodStart, lang)} → ${formatDate(pi.periodEnd, lang)}`
              : null;
          return (
            <div key={pi.id} className="flex justify-between gap-4">
              <dt className="text-slate-500">
                {localizedServiceName(pi.subscriptionItem.service, lang)}
                <EndClientLabel
                  name={pi.subscriptionItem.endClientName}
                  lang={lang}
                />
                {period ? (
                  <span className="block font-mono text-xs text-slate-400">
                    {period}
                  </span>
                ) : null}
              </dt>
              <dd className="text-right font-mono text-xs text-ink">
                {formatEur(
                  splitVatFromGross(pi.amountCents).taxableCents,
                  payment.currency,
                  lang,
                )}
              </dd>
            </div>
          );
        })}

        {/* Riepilogo completo PRIMA del pulsante verso Stripe (le email mostrano
            solo l'imponibile). Totale = Payment.amountCents = Σ line_items del
            checkout (lordo righe + commissione), quindi coincide al centesimo. */}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-3">
          <dt className="text-slate-500">
            {tr(lang, { it: "Imponibile", en: "Taxable amount" })}
          </dt>
          <dd className="text-right font-mono text-xs text-ink">
            {formatEur(taxableCents, payment.currency, lang)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">
            {tr(lang, { it: "IVA (22%)", en: "VAT (22%)" })}
          </dt>
          <dd className="text-right font-mono text-xs text-ink">
            {formatEur(vatCents, payment.currency, lang)}
          </dd>
        </div>
        {payment.serviceFeeCents > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">
              {tr(lang, {
                it: "Commissione di servizio (1,5%)",
                en: "Payment handling fee (1.5%)",
              })}
            </dt>
            <dd className="text-right font-mono text-xs text-ink">
              {formatEur(payment.serviceFeeCents, payment.currency, lang)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-3">
          <dt className="font-medium text-ink">
            {tr(lang, { it: "Totale con carta", en: "Total by card" })}
          </dt>
          <dd className="text-right font-mono text-base font-semibold text-ink">
            {formatEur(payment.amountCents, payment.currency, lang)}
          </dd>
        </div>
      </dl>

      {searchParams.error === "stripe" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {tr(lang, {
            it: "La sessione di pagamento non è più disponibile. Contatta hello@deltasolutions.agency.",
            en: "The payment session is no longer available. Please contact hello@deltasolutions.agency.",
          })}
        </p>
      ) : null}
      {searchParams.error === "consent" ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {tr(lang, {
            it: "Per procedere devi accettare la Privacy Policy e i Termini e Condizioni.",
            en: "To proceed, you must accept the Privacy Policy and the Terms and Conditions.",
          })}
        </p>
      ) : null}

      <div className="mt-5">
        <PayForm
          token={payment.payToken}
          needsConsent={needsConsent}
          canActivateAutoCharge={canActivateAutoCharge}
          lang={lang}
        />
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        {tr(lang, {
          it: "Pagamento sicuro tramite Stripe",
          en: "Secure payment via Stripe",
        })}
      </p>
    </Shell>
  );
}
