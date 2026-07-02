/** Formattazioni condivise per la UI. */

/** Importo da centesimi a stringa valuta (es. 1500 → "15,00 €"). */
export function formatMoney(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Alias di formatMoney per gli importi in euro (es. 1200 → "12,00 €"). */
export function formatEur(cents: number, currency = "eur"): string {
  return formatMoney(cents, currency);
}

/** Data leggibile in italiano (es. "30 giu 2026"). */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}
