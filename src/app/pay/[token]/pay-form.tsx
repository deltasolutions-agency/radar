"use client";

import { useState } from "react";
import { proceedToPayment } from "./actions";

/**
 * Form della pagina pubblica di pagamento. Se serve il consenso, mostra la
 * checkbox obbligatoria e disabilita il pulsante finché non è selezionata.
 */
export function PayForm({
  token,
  needsConsent,
  canActivateAutoCharge,
}: {
  token: string;
  needsConsent: boolean;
  /** true se tutte le righe pagate NON hanno già il rinnovo automatico. */
  canActivateAutoCharge: boolean;
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
            Attiva anche il rinnovo automatico su questa carta per i prossimi
            rinnovi
            <span className="mt-1 block text-xs text-slate-500">
              I servizi verranno rinnovati e addebitati automaticamente su questa
              carta alle prossime scadenze. Puoi revocarlo in qualsiasi momento
              scrivendo a hello@deltasolutions.agency.
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
            Ho letto e accetto la{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              Privacy Policy
            </a>{" "}
            e i{" "}
            <a
              href="/termini"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              Termini e Condizioni
            </a>
          </span>
        </label>
      ) : null}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={(needsConsent && !accepted) || submitting}
      >
        {submitting ? "Attendere…" : "Procedi al pagamento"}
      </button>
    </form>
  );
}
