import Link from "next/link";
import { consentDateLabel, legalHref } from "@/lib/legal";
import { tr, type Lang } from "@/lib/i18n";
import { HtmlLang } from "@/components/html-lang";

const LOGO_URL =
  "/logo-delta-solutions.png";

/**
 * Contenitore condiviso per le pagine legali pubbliche (Privacy, Termini):
 * header con logo brand, titolo, data di aggiornamento e footer.
 *
 * `lang="en"`: traduzione di cortesia con avviso di prevalenza del testo
 * italiano (link `italianHref`). In italiano: piccolo link "English version"
 * (`englishHref`) in alto.
 */
export function LegalShell({
  title,
  children,
  lang = "it",
  italianHref,
  englishHref,
}: {
  title: string;
  children: React.ReactNode;
  lang?: Lang;
  /** Versione italiana (mostrato nel box della traduzione EN). */
  italianHref?: string;
  /** Versione inglese (link in alto nella pagina IT). */
  englishHref?: string;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <HtmlLang lang={lang} />
      <header className="border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="Delta Solutions"
            className="h-7 w-auto"
          />
          <span className="mono-label">Radar</span>
          {lang === "it" && englishHref ? (
            <Link
              href={englishHref}
              hrefLang="en"
              className="ml-auto font-mono text-xs text-brand hover:underline"
            >
              English version
            </Link>
          ) : null}
        </div>
        {lang === "en" ? (
          <div
            role="note"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            This is a courtesy translation. In case of any discrepancy, the
            Italian version shall prevail.
            {italianHref ? (
              <>
                {" "}
                <Link
                  href={italianHref}
                  hrefLang="it"
                  className="font-medium text-brand underline"
                >
                  Read the Italian version
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {tr(lang, { it: "Ultimo aggiornamento", en: "Last updated" })}:{" "}
          {consentDateLabel(lang)}
        </p>
      </header>

      <div className="space-y-5 py-6 text-sm leading-relaxed text-ink">
        {children}
      </div>

      <footer className="border-t border-line pt-5 text-xs text-slate-500">
        <p>Radar — Delta Solutions</p>
        <p className="mt-1">
          <Link href={legalHref("/privacy", lang)} className="text-brand hover:underline">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href={legalHref("/termini", lang)} className="text-brand hover:underline">
            {tr(lang, { it: "Termini e Condizioni", en: "Terms and Conditions" })}
          </Link>
        </p>
      </footer>
    </main>
  );
}
