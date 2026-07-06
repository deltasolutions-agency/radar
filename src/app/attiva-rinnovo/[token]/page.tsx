import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { addVatToNet } from "@/lib/vat";
import { clientDataFieldsFor, ensureDataEditToken } from "@/lib/client-data";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { DataEditForm } from "@/app/i-tuoi-dati/[token]/data-edit-form";
import { ActivateForm } from "./activate-form";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "/logo-delta-solutions.png";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="mb-6 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Delta Solutions" className="h-7 w-auto" />
        <span className="mono-label">Radar</span>
      </div>
      <div className="card p-8">{children}</div>
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
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

  // Carta registrata con successo → solo conferma + CTA recensione (nessun
  // elenco servizi o prezzo: il cliente ha già deciso e attivato).
  if (searchParams.done) {
    return (
      <Shell>
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
            Rinnovo automatico attivato con successo
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            La carta è stata registrata e il rinnovo automatico è ora attivo.
            Riceverai le conferme di pagamento via email.
          </p>
        </div>

        <div className="mt-6">
          <GoogleReviewCta />
        </div>
      </Shell>
    );
  }

  // Richiesta già completata (senza il flag done): link non più utilizzabile.
  if (request.usedAt) {
    return (
      <Message
        title="Link già utilizzato"
        body="Questa richiesta di attivazione è già stata completata. Se hai bisogno di modificare il rinnovo automatico scrivici a hello@deltasolutions.agency."
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
        title="Link non valido"
        body="I servizi collegati a questa richiesta non sono più disponibili. Contatta hello@deltasolutions.agency."
      />
    );
  }

  const needsConsent = !(await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  }));

  // Sezione dati di fatturazione (sola lettura + eventuale modifica).
  const dataEditToken = await ensureDataEditToken(client);
  const dataFields = clientDataFieldsFor(client);

  // Riepilogo IVA aggregato: somma per riga (coerente con l'addebito reale).
  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;
  for (const it of items) {
    const v = addVatToNet(it.priceCents * it.quantity);
    totalNet += v.netCents;
    totalVat += v.vatCents;
    totalGross += v.grossCents;
  }
  const listCurrency = items[0]?.currency ?? "eur";

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">
        Attiva il rinnovo automatico
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <div className="mt-5 rounded-xl border border-line-soft bg-canvas/50 p-4">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          I tuoi dati di fatturazione
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Dai un&apos;occhiata: se è tutto corretto non devi fare nulla.
        </p>
        <div className="mt-3">
          <DataEditForm
            clientId={client.id}
            token={dataEditToken}
            unlocked={client.dataEditUnlocked}
            fields={dataFields}
          />
        </div>
        <p className="mt-3 border-t border-line-soft pt-3 text-[11px] leading-relaxed text-slate-400">
          Confermando questi dati, dichiari che sono corretti. Delta Solutions
          Agency non si assume responsabilità per l&apos;accuratezza delle
          informazioni fornite dal cliente.
        </p>
      </div>

      <p className="mt-6 text-sm text-slate-600">
        Registrando la carta autorizzi l&apos;addebito automatico ricorrente per
        i seguenti servizi, ciascuno alla propria scadenza e periodicità:
      </p>

      <ul className="mt-4 space-y-2 border-t border-line-soft pt-4 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-ink">
                {it.service.name}
                {it.quantity > 1 ? (
                  <span className="text-slate-500"> ×{it.quantity}</span>
                ) : null}
              </p>
              <p className="text-xs text-slate-500">
                {formatBillingPeriod(
                  it.billingPeriod as BillingPeriodValue,
                  it.customPeriodDays,
                )}
              </p>
            </div>
            <span className="shrink-0 font-mono text-ink">
              {formatEur(it.priceCents * it.quantity, it.currency)}
            </span>
          </li>
        ))}
      </ul>

      {/* Riepilogo IVA (imponibile / IVA / totale) coerente con l'addebito. */}
      <dl className="space-y-1 border-y border-line-soft py-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Imponibile</dt>
          <dd className="font-mono text-ink">
            {formatEur(totalNet, listCurrency)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">IVA (22%)</dt>
          <dd className="font-mono text-ink">
            {formatEur(totalVat, listCurrency)}
          </dd>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-line-soft pt-2">
          <dt className="font-medium text-ink">Totale</dt>
          <dd className="font-mono text-base font-semibold text-ink">
            {formatEur(totalGross, listCurrency)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-400">
        Puoi revocare l&apos;autorizzazione in qualsiasi momento scrivendo a
        hello@deltasolutions.agency.
      </p>

      {searchParams.annullato ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Registrazione annullata. Puoi riprovare qui sotto.
        </p>
      ) : null}
      {searchParams.error === "stripe" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Si è verificato un problema con Stripe. Riprova o scrivi a
          hello@deltasolutions.agency.
        </p>
      ) : null}
      {searchParams.error === "config" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Configurazione non disponibile. Contatta hello@deltasolutions.agency.
        </p>
      ) : null}
      {searchParams.error === "consent" ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Per procedere devi accettare la Privacy Policy e i Termini e
          Condizioni.
        </p>
      ) : null}

      <div className="mt-5">
        <ActivateForm token={params.token} needsConsent={needsConsent} />
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        Registrazione carta sicura tramite Stripe · revocabile in qualsiasi
        momento
      </p>
    </Shell>
  );
}
