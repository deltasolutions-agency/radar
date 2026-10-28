import type { Metadata } from "next";
import { GoogleReviewCta } from "@/components/google-review-cta";
import { HtmlLang } from "@/components/html-lang";
import { langFromParam, tr, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "/logo-delta-solutions.png";

type GrazieSearchParams = { annullato?: string; lang?: string };

/** Titolo della scheda nella lingua della pagina (?lang=en). */
export function generateMetadata({
  searchParams,
}: {
  searchParams: GrazieSearchParams;
}): Metadata {
  const lang = langFromParam(searchParams.lang);
  if (lang === "it") return {};
  return {
    title: searchParams.annullato
      ? "Payment cancelled — Radar"
      : "Payment completed — Radar",
  };
}

function Shell({
  children,
  lang,
}: {
  children: React.ReactNode;
  lang: Lang;
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

export default function GraziePage({
  searchParams,
}: {
  searchParams: GrazieSearchParams;
}) {
  // Lingua da ?lang=en (assente → italiano).
  const lang = langFromParam(searchParams.lang);

  // Pagamento annullato dall'utente sul checkout Stripe.
  if (searchParams.annullato) {
    return (
      <Shell lang={lang}>
        <h1 className="text-lg font-semibold tracking-tight">
          {tr(lang, { it: "Pagamento annullato", en: "Payment cancelled" })}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {tr(lang, {
            it: "Non è stato addebitato nulla. Puoi riprovare dal link ricevuto via email, oppure scrivici a",
            en: "Nothing has been charged. You can try again from the link you received by email, or write to us at",
          })}{" "}
          <a
            href="mailto:hello@deltasolutions.agency"
            className="text-brand underline"
          >
            hello@deltasolutions.agency
          </a>{" "}
          {tr(lang, { it: "per assistenza.", en: "for assistance." })}
        </p>
      </Shell>
    );
  }

  return (
    <Shell lang={lang}>
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
          {tr(lang, { it: "Pagamento completato", en: "Payment completed" })}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {tr(lang, {
            it: "Grazie! Abbiamo ricevuto il tuo pagamento. Riceverai a breve la conferma e la ricevuta via email.",
            en: "Thank you! We have received your payment. You will shortly receive the confirmation and receipt by email.",
          })}
        </p>
      </div>

      {/* Invito alla recensione Google (componente condiviso) */}
      <div className="mt-8">
        <GoogleReviewCta lang={lang} />
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Radar — Delta Solutions · hello@deltasolutions.agency
      </p>
    </Shell>
  );
}
