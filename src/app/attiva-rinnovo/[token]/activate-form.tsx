"use client";

import { useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { legalHref } from "@/lib/legal";
import { activateAutoCharge } from "./actions";

/**
 * Form pubblico di attivazione rinnovo automatico. Se serve il consenso, mostra
 * la checkbox obbligatoria e disabilita il pulsante finché non è selezionata.
 */
export function ActivateForm({
  token,
  needsConsent,
  lang = "it",
}: {
  token: string;
  needsConsent: boolean;
  lang?: Lang;
}) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={activateAutoCharge} onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="token" value={token} />

      {needsConsent ? (
        <label className="mb-4 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="consent"
            className="mt-0.5"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            {tr(lang, { it: "Ho letto e accetto la", en: "I have read and accept the" })}{" "}
            <a
              href={legalHref("/privacy", lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              Privacy Policy
            </a>{" "}
            {tr(lang, { it: "e i", en: "and the" })}{" "}
            <a
              href={legalHref("/termini", lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              {tr(lang, { it: "Termini e Condizioni", en: "Terms and Conditions" })}
            </a>
          </span>
        </label>
      ) : null}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={(needsConsent && !accepted) || submitting}
      >
        {submitting
          ? tr(lang, { it: "Attendere…", en: "Please wait…" })
          : tr(lang, {
              it: "Attiva rinnovo automatico e registra carta",
              en: "Activate automatic renewal and save card",
            })}
      </button>
    </form>
  );
}
