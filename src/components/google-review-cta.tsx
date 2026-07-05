const GOOGLE_REVIEW_URL = "https://g.page/r/CdpvuufBNl3PEBM/review";

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
          width="22"
          height="22"
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

/**
 * Sezione CTA condivisa per la recensione Google. Unico punto per le tre
 * posizioni (/pay/grazie, /attiva-rinnovo done, /r ricevuta) così testo e stile
 * del pulsante restano allineati.
 *
 * - variant "prominent": riquadro con gradiente (pagine di ringraziamento).
 * - variant "subtle": riquadro leggero, tono composto (ricevuta/documento).
 *
 * L'intera sezione è nascosta in stampa (print:hidden): un CTA online non ha
 * senso su carta.
 */
export function GoogleReviewCta({
  title = "Ti va di lasciarci una recensione?",
  description = "Bastano 30 secondi e per noi fa una grande differenza. Raccontare la tua esperienza aiuta altri a scegliere Delta Solutions.",
  variant = "prominent",
  showStars = true,
}: {
  title?: string;
  description?: string;
  variant?: "prominent" | "subtle";
  showStars?: boolean;
}) {
  const boxClass =
    variant === "prominent"
      ? "rounded-2xl border border-line bg-gradient-to-b from-canvas to-white p-6 text-center"
      : "rounded-xl border border-line-soft bg-canvas p-5 text-center";

  return (
    <div className={`google-review-cta print:hidden ${boxClass}`}>
      {showStars ? <Stars /> : null}
      <h2 className="mt-3 text-base font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-slate-600">{description}</p>
      <a
        href={GOOGLE_REVIEW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="review-pulse mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#ffffff"
            d="M21.35 11.1H12v2.9h5.35c-.25 1.4-1.6 4.1-5.35 4.1a5.9 5.9 0 1 1 0-11.8c1.7 0 2.85.72 3.5 1.34l2.4-2.32A9.3 9.3 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.65-3.65 8.65-8.8 0-.6-.07-1.05-.3-2.1z"
          />
        </svg>
        Lasciaci un tuo feedback
      </a>
    </div>
  );
}
