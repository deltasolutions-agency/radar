"use client";

import { useState } from "react";

/**
 * Anteprima di un'email registrata: rendering HTML in un iframe con sandbox
 * vuota (nessuno script, nessun form, origine isolata) + sorgente e testo.
 */
export function EmailPreview({ html, text }: { html: string; text: string | null }) {
  const [tab, setTab] = useState<"preview" | "source" | "text">("preview");
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "preview", label: "Anteprima" },
    { key: "source", label: "HTML sorgente" },
    { key: "text", label: "Testo" },
  ];
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-1 border-b border-line px-2 text-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 font-medium transition ${
              tab === t.key
                ? "border-brand text-ink"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "preview" ? (
        <iframe
          title="Anteprima email"
          sandbox=""
          srcDoc={html}
          className="h-[70vh] w-full bg-white"
        />
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-slate-700">
          {tab === "source" ? html : text?.trim() ? text : "(nessuna versione testo)"}
        </pre>
      )}
    </div>
  );
}
