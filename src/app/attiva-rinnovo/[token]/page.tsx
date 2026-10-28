import { prisma } from "@/lib/prisma";
import { EXAMPLE_TOKEN } from "@/lib/example-link";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { EndClientLabel } from "@/components/end-client-label";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { addVatToNet } from "@/lib/vat";
import { clientDataFieldsFor, ensureDataEditToken } from "@/lib/client-data";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { DataEditForm } from "@/app/i-tuoi-dati/[token]/data-edit-form";
import { langOf, localizedServiceName, tr, type Lang } from "@/lib/i18n";
import { HtmlLang } from "@/components/html-lang";
import { ActivateForm } from "./activate-form";

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

export default async function AttivaRinnovoPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { done?: string; annullato?: string; error?: string };
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

  const request = await prisma.autoChargeRequest.findUnique({
    where: { token: params.token },
    include: { client: true },
  });

  if (!request) {
    return (
      <Message
        title="Link non valido"
        body="Questo link di attivazione non è valido o non è più disponibile."
      />
    );
  }

  // Lingua del cliente della richiesta.
  const lang: Lang = langOf(request.client.locale);

  // Carta registrata con successo → solo conferma + CTA recensione (nessun
  // elenco servizi o prezzo: il cliente ha già deciso e attivato).
  if (searchParams.done) {
    return (
      <Shell lang={lang}>
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#059669"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">
            {tr(lang, {
              it: "Rinnovo automatico attivato con successo",
              en: "Automatic renewal successfully activated",
            })}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {tr(lang, {
              it: "La carta è stata registrata e il rinnovo automatico è ora attivo. Riceverai le conferme di pagamento via email.",
              en: "Your card has been saved and automatic renewal is now active. You will receive payment confirmations by email.",
            })}
          </p>
        </div>

        <div className="mt-6">
          <GoogleReviewCta lang={lang} />
        </div>
      </Shell>
    );
  }

  // Richiesta già completata (senza il flag done): link non più utilizzabile.
  if (request.usedAt) {
    return (
      <Message
        lang={lang}
        title={tr(lang, { it: "Link già utilizzato", en: "Link already used" })}
        body={tr(lang, {
          it: "Questa richiesta di attivazione è già stata completata. Se hai bisogno di modificare il rinnovo automatico scrivici a hello@deltasolutions.agency.",
          en: "This activation request has already been completed. If you need to change your automatic renewal, write to us at hello@deltasolutions.agency.",
        })}
      />
    );
  }

  const client = request.client;

  // Carica ESATTAMENTE i servizi della richiesta (subset scelto dall'admin).
  const items = await prisma.subscriptionItem.findMany({
    where: { id: { in: request.itemIds } },
    include: { service: true },
    orderBy: { endDate: "asc" },
  });

  if (items.length === 0) {
    return (
      <Message
        lang={lang}
        title={tr(lang, { it: "Link non valido", en: "Invalid link" })}
        body={tr(lang, {
          it: "I servizi collegati a questa richiesta non sono più disponibili. Contatta hello@deltasolutions.agency.",
          en: "The services linked to this request are no longer available. Please contact hello@deltasolutions.agency.",
        })}
      />
    );
  }

  const needsConsent = !(await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  }));

  // Sezione dati di fatturazione (sola lettura + eventuale modifica).
  const dataEditToken = await ensureDataEditToken(client);
  const dataFields = clientDataFieldsFor(client, lang);

  // Riepilogo IVA aggregato: somma per riga (coerente con l'addebito reale).
  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;
  for (const it of items) {
    // Importo del prossimo rinnovo (aumento incluso se dovuto).
    const v = addVatToNet(renewalChargePriceCents(it) * it.quantity);
    totalNet += v.netCents;
    totalVat += v.vatCents;
    totalGross += v.grossCents;
  }
  const listCurrency = items[0]?.currency ?? "eur";

  return (
    <Shell lang={lang}>
      <h1 className="text-lg font-semibold tracking-tight">
        {tr(lang, {
          it: "Attiva il rinnovo automatico",
          en: "Activate automatic renewal",
        })}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <div className="mt-5 rounded-xl border border-line-soft bg-canvas/50 p-4">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          {tr(lang, {
            it: "I tuoi dati di fatturazione",
            en: "Your billing details",
          })}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {tr(lang, {
            it: "Dai un'occhiata: se è tutto corretto non devi fare nulla.",
            en: "Take a look: if everything is correct, you don't need to do anything.",
          })}
        </p>
        <div className="mt-3">
          <DataEditForm
            clientId={client.id}
            token={dataEditToken}
            unlocked={client.dataEditUnlocked}
            fields={dataFields}
            lang={lang}
          />
        </div>
        <p className="mt-3 border-t border-line-soft pt-3 text-[11px] leading-relaxed text-slate-400">
          {tr(lang, {
            it: "Confermando questi dati, dichiari che sono corretti. Delta Solutions Agency non si assume responsabilità per l'accuratezza delle informazioni fornite dal cliente.",
            en: "By confirming these details, you declare that they are correct. Delta Solutions Agency accepts no responsibility for the accuracy of the information provided by the client.",
          })}
        </p>
      </div>

      <p className="mt-6 text-sm text-slate-600">
        {tr(lang, {
          it: "Registrando la carta autorizzi l'addebito automatico ricorrente per i seguenti servizi, ciascuno alla propria scadenza e periodicità:",
          en: "By saving your card, you authorise recurring automatic charges for the following services, each at its own expiry date and billing frequency:",
        })}
      </p>

      <ul className="mt-4 space-y-2 border-t border-line-soft pt-4 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-ink">
                {localizedServiceName(it.service, lang)}
                {it.quantity > 1 ? (
                  <span className="text-slate-500"> ×{it.quantity}</span>
                ) : null}
              </p>
              <EndClientLabel name={it.endClientName} lang={lang} />
              <p className="text-xs text-slate-500">
                {formatBillingPeriod(
                  it.billingPeriod as BillingPeriodValue,
                  it.customPeriodDays,
                  lang,
                )}
              </p>
            </div>
            <span className="shrink-0 font-mono text-ink">
              {formatEur(
                renewalChargePriceCents(it) * it.quantity,
                it.currency,
                lang,
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* Riepilogo IVA (imponibile / IVA / totale) coerente con l'addebito. */}
      <dl className="space-y-1 border-y border-line-soft py-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">
            {tr(lang, { it: "Imponibile", en: "Taxable amount" })}
          </dt>
          <dd className="font-mono text-ink">
            {formatEur(totalNet, listCurrency, lang)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">
            {tr(lang, { it: "IVA (22%)", en: "VAT (22%)" })}
          </dt>
          <dd className="font-mono text-ink">
            {formatEur(totalVat, listCurrency, lang)}
          </dd>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-line-soft pt-2">
          <dt className="font-medium text-ink">
            {tr(lang, { it: "Totale", en: "Total" })}
          </dt>
          <dd className="font-mono text-base font-semibold text-ink">
            {formatEur(totalGross, listCurrency, lang)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-400">
        {tr(lang, {
          it: "Puoi revocare l'autorizzazione in qualsiasi momento scrivendo a hello@deltasolutions.agency.",
          en: "You can revoke this authorisation at any time by writing to hello@deltasolutions.agency.",
        })}
      </p>

      {searchParams.annullato ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {tr(lang, {
            it: "Registrazione annullata. Puoi riprovare qui sotto.",
            en: "Card registration cancelled. You can try again below.",
          })}
        </p>
      ) : null}
      {searchParams.error === "stripe" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {tr(lang, {
            it: "Si è verificato un problema con Stripe. Riprova o scrivi a hello@deltasolutions.agency.",
            en: "There was a problem with Stripe. Please try again or write to hello@deltasolutions.agency.",
          })}
        </p>
      ) : null}
      {searchParams.error === "config" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {tr(lang, {
            it: "Configurazione non disponibile. Contatta hello@deltasolutions.agency.",
            en: "Configuration unavailable. Please contact hello@deltasolutions.agency.",
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
        <ActivateForm
          token={params.token}
          needsConsent={needsConsent}
          lang={lang}
        />
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        {tr(lang, {
          it: "Registrazione carta sicura tramite Stripe · revocabile in qualsiasi momento",
          en: "Secure card registration via Stripe · revocable at any time",
        })}
      </p>
    </Shell>
  );
}
