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
}: {
  token: string;
  needsConsent: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={proceedToPayment} onSubmit={() => setSubmitting(true)}>
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
