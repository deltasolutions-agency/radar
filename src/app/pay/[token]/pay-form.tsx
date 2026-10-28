"use client";

import { useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { legalHref } from "@/lib/legal";
import { proceedToPayment } from "./actions";

/**
 * Form della pagina pubblica di pagamento. Se serve il consenso, mostra la
 * checkbox obbligatoria e disabilita il pulsante finché non è selezionata.
 */
export function PayForm({
  token,
  needsConsent,
  canActivateAutoCharge,
  lang = "it",
}: {
  token: string;
  needsConsent: boolean;
  /** true se tutte le righe pagate NON hanno già il rinnovo automatico. */
  canActivateAutoCharge: boolean;
  lang?: Lang;
}) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={proceedToPayment} onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="token" value={token} />

      {canActivateAutoCharge ? (
        <label className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="activateAutoCharge"
            className="mt-0.5"
          />
          <span>
            {tr(lang, {
              it: "Attiva anche il rinnovo automatico su questa carta per i prossimi rinnovi",
              en: "Also activate automatic renewal on this card for future renewals",
            })}
            <span className="mt-1 block text-xs text-slate-500">
              {tr(lang, {
                it: "I servizi verranno rinnovati e addebitati automaticamente su questa carta alle prossime scadenze. Puoi revocarlo in qualsiasi momento scrivendo a hello@deltasolutions.agency.",
                en: "Your services will be renewed and charged automatically to this card at their next expiry dates. You can revoke this at any time by writing to hello@deltasolutions.agency.",
              })}
            </span>
          </span>
        </label>
      ) : null}

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
          : tr(lang, { it: "Procedi al pagamento", en: "Proceed to payment" })}
      </button>
    </form>
  );
}
