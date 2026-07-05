import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { ActivateForm } from "./activate-form";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

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

  // Carta registrata con successo.
  if (searchParams.done) {
    return (
      <Message
        title="Grazie!"
        body="La carta è stata registrata. Il rinnovo automatico è attivo sui servizi indicati. Riceverai le conferme di pagamento via email."
      />
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

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">
        Attiva il rinnovo automatico
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <p className="mt-4 text-sm text-slate-600">
        Registrando la carta autorizzi l&apos;addebito automatico ricorrente per
        i seguenti servizi, ciascuno alla propria scadenza e periodicità:
      </p>

      <ul className="mt-4 space-y-2 border-y border-line-soft py-4 text-sm">
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
