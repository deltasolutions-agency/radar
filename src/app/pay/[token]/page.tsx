import { prisma } from "@/lib/prisma";
import { formatEur, formatDate } from "@/lib/format";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { PayForm } from "./pay-form";

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

export default async function PayPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string };
}) {
  const payment = await prisma.payment.findUnique({
    where: { payToken: params.token },
    include: {
      subscription: { include: { client: true } },
      items: {
        include: { subscriptionItem: { include: { service: true } } },
      },
    },
  });

  if (!payment || payment.status !== "IN_ATTESA") {
    return (
      <Message
        title="Link non valido"
        body="Link non valido o pagamento già gestito."
      />
    );
  }

  if (
    payment.checkoutExpiresAt &&
    payment.checkoutExpiresAt.getTime() < Date.now()
  ) {
    return (
      <Message
        title="Link scaduto"
        body="Link scaduto, contatta hello@deltasolutions.agency."
      />
    );
  }

  const client = payment.subscription.client;

  const existingConsent = await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  });
  const needsConsent = !existingConsent;

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">
        Pagamento abbonamento
      </h1>
      <p className="mt-1 text-sm text-slate-500">{client.name}</p>

      <dl className="mt-5 space-y-3 border-y border-line-soft py-4 text-sm">
        {payment.items.map((pi) => {
          const period =
            pi.periodStart && pi.periodEnd
              ? `${formatDate(pi.periodStart)} → ${formatDate(pi.periodEnd)}`
              : null;
          return (
            <div key={pi.id} className="flex justify-between gap-4">
              <dt className="text-slate-500">
                {pi.subscriptionItem.service.name}
                {period ? (
                  <span className="block font-mono text-xs text-slate-400">
                    {period}
                  </span>
                ) : null}
              </dt>
              <dd className="text-right font-mono text-xs text-ink">
                {formatEur(pi.amountCents, payment.currency)}
              </dd>
            </div>
          );
        })}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-3">
          <dt className="text-slate-500">Importo totale</dt>
          <dd className="text-right font-mono text-base font-semibold text-ink">
            {formatEur(payment.amountCents, payment.currency)}
          </dd>
        </div>
      </dl>

      {searchParams.error === "stripe" ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          La sessione di pagamento non è più disponibile. Contatta
          hello@deltasolutions.agency.
        </p>
      ) : null}
      {searchParams.error === "consent" ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Per procedere devi accettare la Privacy Policy e i Termini e
          Condizioni.
        </p>
      ) : null}

      <div className="mt-5">
        <PayForm token={payment.payToken} needsConsent={needsConsent} />
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        Pagamento sicuro tramite Stripe
      </p>
    </Shell>
  );
}
