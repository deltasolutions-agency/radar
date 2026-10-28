import { intlLocale, type Lang } from "@/lib/i18n";

/**
 * Versione corrente del testo legale (Privacy Policy + Termini e Condizioni).
 * Deve coincidere tra le pagine pubbliche e il ConsentLog: se il testo cambia,
 * si aggiorna QUESTA costante e i clienti dovranno ri-accettare.
 */
export const CURRENT_CONSENT_VERSION = "2026-07-02";

/** Etichetta leggibile della versione corrente (mostrata nelle pagine). */
export const CURRENT_CONSENT_DATE_LABEL = "2 luglio 2026";

/**
 * Data della versione corrente formattata nella lingua della pagina
 * (IT: "2 luglio 2026" invariato; EN: "2 July 2026"). Stessa versione.
 */
export function consentDateLabel(lang: Lang = "it"): string {
  if (lang === "it") return CURRENT_CONSENT_DATE_LABEL;
  const [y, m, d] = CURRENT_CONSENT_VERSION.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Link alle pagine legali nella lingua del cliente ("/privacy?lang=en"). */
export function legalHref(path: "/privacy" | "/termini", lang: Lang = "it"): string {
  return lang === "en" ? `${path}?lang=en` : path;
}
