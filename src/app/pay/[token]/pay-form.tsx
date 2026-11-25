"use client";

import { useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { legalHref } from "@/lib/legal";
import {
  CLOUD_DPA_PATH,
  CLOUD_TERMS_PATH,
  CLOUD_VESSATORIE_EN,
  CLOUD_VESSATORIE_IT,
} from "@/lib/cloud-legal";
import { proceedToPayment } from "./actions";

/**
 * Form della pagina pubblica di pagamento. Se serve il consenso, mostra la
 * checkbox obbligatoria e disabilita il pulsante finché non è selezionata.
 *
 * Pagamenti di Delta Solutions Cloud (`cloud`): al posto del consenso standard
 * di Radar c'è la casella di approvazione specifica delle clausole (artt. 1341-
 * 1342 c.c.); il clic su "Accetta e paga" vale come accettazione di Condizioni
 * e DPA del Cloud.
 */
export function PayForm({
  token,
  needsConsent,
  canActivateAutoCharge,
  requireAutoCharge = false,
  cloud = false,
  needsCloudConsent = false,
  lang = "it",
}: {
  token: string;
  needsConsent: boolean;
  /** true se tutte le righe pagate NON hanno già il rinnovo automatico. */
  canActivateAutoCharge: boolean;
  /** Abbonamento della console: la carta resta per i rinnovi, casella fissa. */
  requireAutoCharge?: boolean;
  /** Pagamento di Delta Solutions Cloud (abbonamento della console). */
  cloud?: boolean;
  /** Il cliente non ha ancora accettato la versione corrente di Condizioni e DPA. */
  needsCloudConsent?: boolean;
  lang?: Lang;
}) {
  const [accepted, setAccepted] = useState(false);
  const [cloudAccepted, setCloudAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const blocked = cloud
    ? needsCloudConsent && !cloudAccepted
    : needsConsent && !accepted;

  return (
    <form action={proceedToPayment} onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="token" value={token} />

      {requireAutoCharge ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink">
          <input type="hidden" name="activateAutoCharge" value="on" />
          <input type="checkbox" checked disabled readOnly className="mt-0.5" aria-label="Rinnovo automatico" />
          <span>
            {tr(lang, {
              it: "Rinnovo automatico su questa carta",
              en: "Automatic renewal on this card",
            })}
            <span className="mt-1 block text-xs text-slate-500">
              {cloud
                ? tr(lang, {
                    it: "Le rate mensili del contratto annuale verranno addebitate automaticamente su questa carta alle prossime scadenze, come previsto dalle Condizioni di servizio. Ti avvisiamo via email prima di ogni addebito. Per cambiare carta o per qualsiasi domanda scrivi a hello@deltasolutions.agency.",
                    en: "The monthly instalments of the annual contract will be charged automatically to this card at each due date, as set out in the Terms of Service. We email you before every charge. To change card or for any question write to hello@deltasolutions.agency.",
                  })
                : tr(lang, {
                    it: "Il canone mensile verrà addebitato automaticamente su questa carta alle prossime scadenze, come previsto dal contratto. Ti avvisiamo via email prima di ogni addebito. Per cambiare carta o per qualsiasi domanda scrivi a hello@deltasolutions.agency.",
                    en: "The monthly fee will be charged automatically to this card at each renewal, as set out in the contract. We email you before every charge. To change card or for any question write to hello@deltasolutions.agency.",
                  })}
            </span>
          </span>
        </div>
      ) : canActivateAutoCharge ? (
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

      {cloud && needsCloudConsent ? (
        <>
          <label className="mb-3 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="cloudTerms"
              className="mt-0.5"
              checked={cloudAccepted}
              onChange={(e) => setCloudAccepted(e.target.checked)}
            />
            <span>
              {tr(lang, {
                it: `Approvo specificamente, ai sensi degli artt. 1341 e 1342 c.c., le clausole ${CLOUD_VESSATORIE_IT} delle`,
                en: `I specifically approve, pursuant to Articles 1341 and 1342 of the Italian Civil Code, clauses ${CLOUD_VESSATORIE_EN} of the`,
              })}{" "}
              <a
                href={CLOUD_TERMS_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand underline"
              >
                {tr(lang, { it: "Condizioni di servizio", en: "Terms of Service" })}
              </a>
            </span>
          </label>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">
            {tr(lang, {
              it: "Cliccando «Accetta e paga» accetti le",
              en: "By clicking “Accept and pay” you accept the",
            })}{" "}
            <a
              href={CLOUD_TERMS_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              {tr(lang, { it: "Condizioni di servizio", en: "Terms of Service" })}
            </a>{" "}
            {tr(lang, { it: "e l'", en: "and the" })}
            {lang === "en" ? " " : ""}
            <a
              href={CLOUD_DPA_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              {tr(lang, {
                it: "Accordo sul trattamento dei dati (DPA)",
                en: "Data Processing Agreement (DPA)",
              })}
            </a>{" "}
            {tr(lang, {
              it: "di Delta Solutions Cloud.",
              en: "of Delta Solutions Cloud (Italian text).",
            })}{" "}
            ·{" "}
            <a
              href={legalHref("/privacy", lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              {tr(lang, { it: "Informativa privacy", en: "Privacy Policy" })}
            </a>
          </p>
        </>
      ) : null}

      {!cloud && needsConsent ? (
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
        disabled={blocked || submitting}
      >
        {submitting
          ? tr(lang, { it: "Attendere…", en: "Please wait…" })
          : cloud && needsCloudConsent
            ? tr(lang, { it: "Accetta e paga", en: "Accept and pay" })
            : tr(lang, { it: "Procedi al pagamento", en: "Proceed to payment" })}
      </button>
    </form>
  );
}
