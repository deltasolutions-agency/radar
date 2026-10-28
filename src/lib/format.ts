/** Formattazioni condivise per la UI. `lang` (default "it") solo per i testi al cliente. */
import { intlLocale, type Lang } from "@/lib/i18n";

/** Importo da centesimi a stringa valuta (es. 1500 → "15,00 €"). */
export function formatMoney(cents: number, currency = "eur", lang: Lang = "it"): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Alias di formatMoney per gli importi in euro (es. 1200 → "12,00 €"). */
export function formatEur(cents: number, currency = "eur", lang: Lang = "it"): string {
  return formatMoney(cents, currency, lang);
}

/** Data leggibile (es. "30 giu 2026" / "30 Jun 2026"). */
export function formatDate(date: Date | string, lang: Lang = "it"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(date: Date | string, lang: Lang = "it"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
