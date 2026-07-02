import Link from "next/link";
import { CURRENT_CONSENT_DATE_LABEL } from "@/lib/legal";

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

/**
 * Contenitore condiviso per le pagine legali pubbliche (Privacy, Termini):
 * header con logo brand, titolo, data di aggiornamento e footer.
 */
export function LegalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="Delta Solutions"
            className="h-7 w-auto"
          />
          <span className="mono-label">Radar</span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          Ultimo aggiornamento: {CURRENT_CONSENT_DATE_LABEL}
        </p>
      </header>

      <div className="space-y-5 py-6 text-sm leading-relaxed text-ink">
        {children}
      </div>

      <footer className="border-t border-line pt-5 text-xs text-slate-500">
        <p>Radar — Delta Solutions</p>
        <p className="mt-1">
          <Link href="/privacy" className="text-brand hover:underline">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/termini" className="text-brand hover:underline">
            Termini e Condizioni
          </Link>
        </p>
      </footer>
    </main>
  );
}
