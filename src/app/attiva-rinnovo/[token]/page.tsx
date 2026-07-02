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
  const sub = await prisma.subscription.findUnique({
    where: { autoChargeSetupToken: params.token },
    include: { client: true, service: true },
  });

  if (!sub) {
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
        body="La carta è stata registrata. Il rinnovo automatico sarà attivato a breve. Riceverai le conferme di pagamento via email."
      />
    );
  }

  const needsConsent = !(await prisma.consentLog.findFirst({
    where: { clientId: sub.clientId, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  }));

  const periodicity = formatBillingPeriod(
    sub.billingPeriod as BillingPeriodValue,
    sub.customPeriodDays,
  );

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">
        Attiva il rinnovo automatico
      </h1>
      <p className="mt-1 text-sm text-slate-500">{sub.client.name}</p>

      <dl className="mt-5 space-y-2 border-y border-line-soft py-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Servizio</dt>
          <dd className="text-right text-ink">{sub.service.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Periodicità</dt>
          <dd className="text-right text-ink">{periodicity}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Importo per addebito</dt>
          <dd className="text-right font-mono text-base font-semibold text-ink">
            {formatEur(sub.priceCents, sub.currency)}
          </dd>
        </div>
      </dl>

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
