import { GoogleReviewCta } from "@/components/google-review-cta";

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

export default function GraziePage({
  searchParams,
}: {
  searchParams: { annullato?: string };
}) {
  // Pagamento annullato dall'utente sul checkout Stripe.
  if (searchParams.annullato) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">
          Pagamento annullato
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Non è stato addebitato nulla. Puoi riprovare dal link ricevuto via
          email, oppure scrivici a{" "}
          <a
            href="mailto:hello@deltasolutions.agency"
            className="text-brand underline"
          >
            hello@deltasolutions.agency
          </a>{" "}
          per assistenza.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Conferma pagamento */}
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
          Pagamento completato
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Grazie! Abbiamo ricevuto il tuo pagamento. Riceverai a breve la
          conferma e la ricevuta via email.
        </p>
      </div>

      {/* Invito alla recensione Google (componente condiviso) */}
      <div className="mt-8">
        <GoogleReviewCta />
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Radar — Delta Solutions · hello@deltasolutions.agency
      </p>
    </Shell>
  );
}
