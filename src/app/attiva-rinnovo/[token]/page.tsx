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
  const item = await prisma.subscriptionItem.findUnique({
    where: { autoChargeSetupToken: params.token },
    include: { service: true, subscription: { include: { client: true } } },
  });

  if (!item) {
    return (
      <Message
        title="Link non valido"
        body="Questo link di attivazione non è valido o non è più disponibile."
      />
    );
  }

  const client = item.subscription.client;

  // Carta registrata con successo.
  if (searchParams.done) {
    return (
      <Message
        title="Grazie!"
        body="La carta è stata registrata. Il rinnovo automatico è attivo su tutti i tuoi servizi. Riceverai le conferme di pagamento via email."
      />
    );
  }

  const needsConsent = !(await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  }));

  // Rinnovo CUMULATIVO: la carta registrata coprirà TUTTI i servizi attivi del
  // cliente, non solo quello del token. Elenchiamoli con importo e periodicità.
  const services = await prisma.subscriptionItem.findMany({
    where: {
      subscription: { clientId: client.id },
      status: { notIn: ["CESSATO", "SOSPESO"] },
    },
    include: { service: true },
    orderBy: { endDate: "asc" },
  });

  // Fallback difensivo: se per qualche motivo la query non trova righe, mostra
  // almeno quella del token.
  const listed = services.length > 0 ? services : [item];

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">
        Attiva il rinnovo automatico
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <p className="mt-4 text-sm text-slate-600">
        Registrando la carta autorizzi l&apos;addebito automatico ricorrente per{" "}
        <strong>tutti i tuoi servizi attivi presso Delta Solutions</strong>,
        ciascuno alla propria scadenza e periodicità:
      </p>

      <ul className="mt-4 space-y-2 border-y border-line-soft py-4 text-sm">
        {listed.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-ink">{s.service.name}</p>
              <p className="text-xs text-slate-500">
                {formatBillingPeriod(
                  s.billingPeriod as BillingPeriodValue,
                  s.customPeriodDays,
                )}
              </p>
            </div>
            <span className="shrink-0 font-mono text-ink">
              {formatEur(s.priceCents * s.quantity, s.currency)}
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
