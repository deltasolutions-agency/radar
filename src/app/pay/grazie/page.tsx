export const dynamic = "force-dynamic";

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

const GOOGLE_REVIEW_URL = "https://g.page/r/CdpvuufBNl3PEBM/review";

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

/** Cinque stelle piene (decorative). */
function Stars() {
  return (
    <div
      className="flex justify-center gap-1"
      role="img"
      aria-label="Cinque stelle"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="#f59e0b"
          aria-hidden="true"
        >
          <path d="M12 2l2.9 6.26L21.5 9.3l-4.75 4.64L17.9 21 12 17.27 6.1 21l1.15-7.06L2.5 9.3l6.6-1.04L12 2z" />
        </svg>
      ))}
    </div>
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

      {/* Invito alla recensione Google */}
      <div className="mt-8 rounded-2xl border border-line bg-gradient-to-b from-canvas to-white p-6 text-center">
        <Stars />
        <h2 className="mt-3 text-base font-semibold tracking-tight text-ink">
          Ti va di lasciarci una recensione?
        </h2>
        <p className="mt-1.5 text-sm text-slate-600">
          Bastano 30 secondi e per noi fa una grande differenza. Raccontare la
          tua esperienza aiuta altri a scegliere Delta Solutions.
        </p>
        <a
          href={GOOGLE_REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#ffffff"
              d="M21.35 11.1H12v2.9h5.35c-.25 1.4-1.6 4.1-5.35 4.1a5.9 5.9 0 1 1 0-11.8c1.7 0 2.85.72 3.5 1.34l2.4-2.32A9.3 9.3 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.65-3.65 8.65-8.8 0-.6-.07-1.05-.3-2.1z"
            />
          </svg>
          Lascia una recensione su Google
        </a>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Radar — Delta Solutions · hello@deltasolutions.agency
      </p>
    </Shell>
  );
}
