import Link from "next/link";
import { HtmlLang } from "@/components/html-lang";
import {
  CLOUD_DPA_PATH,
  CLOUD_TERMS_DATE_LABEL,
  CLOUD_TERMS_PATH,
  CLOUD_TERMS_VERSION,
  FORNITORE,
  type LegalSection,
} from "@/lib/cloud-legal";

const LOGO_URL = "/logo-delta-solutions.png";

function Paragraphs({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((t, i) => (
        <p key={i} className="mt-2 text-slate-700">
          {t}
        </p>
      ))}
    </>
  );
}

/**
 * Pagina pubblica di un documento legale di Delta Solutions Cloud
 * (Condizioni generali o DPA). Solo italiano.
 */
export function CloudLegalDoc({
  title,
  intro,
  sections,
  role,
}: {
  title: string;
  intro: string[];
  sections: LegalSection[];
  /** Ruolo del Fornitore nell'intestazione (es. "Responsabile del trattamento"). */
  role: string;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <HtmlLang lang="it" />
      <header className="border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_URL} alt="Delta Solutions" className="h-7 w-auto" />
          <span className="mono-label">Delta Solutions Cloud</span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          Versione {CLOUD_TERMS_VERSION} · in vigore dal {CLOUD_TERMS_DATE_LABEL}
        </p>
      </header>

      <div className="space-y-5 py-6 text-sm leading-relaxed text-ink">
        <section className="space-y-2">
          {intro.map((t, i) => (
            <p key={i} className="text-slate-700">
              {t}
            </p>
          ))}
          <p className="text-slate-700">
            <span className="font-medium text-ink">{role}:</span> {FORNITORE}
          </p>
        </section>

        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="mb-1 font-semibold">{s.h}</h2>
            <Paragraphs items={s.p} />
            {s.list?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                {s.list.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : null}
            {s.table ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {s.table.head.map((h) => (
                        <th
                          key={h}
                          className="border-b border-line py-2 pr-3 font-semibold text-ink"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((r, i) => (
                      <tr key={i} className="align-top">
                        {r.map((c, j) => (
                          <td
                            key={j}
                            className="border-b border-line-soft py-2 pr-3 text-slate-700"
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <Paragraphs items={s.after} />
          </section>
        ))}
      </div>

      <footer className="border-t border-line pt-5 text-xs text-slate-500">
        <p>Delta Solutions Cloud — Delta Solutions</p>
        <p className="mt-1">
          <Link href={CLOUD_TERMS_PATH} className="text-brand hover:underline">
            Condizioni generali di servizio
          </Link>{" "}
          ·{" "}
          <Link href={CLOUD_DPA_PATH} className="text-brand hover:underline">
            Accordo sul trattamento dei dati (DPA)
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="text-brand hover:underline">
            Privacy Policy
          </Link>
        </p>
      </footer>
    </main>
  );
}
