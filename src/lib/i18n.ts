/**
 * Lingua delle comunicazioni destinate al CLIENTE (email, pagine pubbliche,
 * PDF, Stripe). L'interfaccia admin e le email admin restano in italiano.
 *
 * Nessuna libreria: i testi sono affiancati nel punto in cui servono con
 * `tr(lang, { it: "…", en: "…" })`. Il tipo `Record<Lang, …>` obbliga a fornire
 * TUTTE le lingue: aggiungendone una nuova, il compilatore segnala ogni testo
 * ancora da tradurre.
 */
import type { Locale } from "@prisma/client";

export const LANGS = ["it", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Testo disponibile in tutte le lingue. */
export type Localized<T = string> = Record<Lang, T>;

/** Locale Prisma (IT/EN) → Lang. Default italiano. */
export function langOf(locale: Locale | string | null | undefined): Lang {
  return String(locale ?? "").toUpperCase() === "EN" ? "en" : "it";
}

/** Lang → enum Prisma Locale. */
export function localeOf(lang: Lang): Locale {
  return lang === "en" ? "EN" : "IT";
}

/** Legge un parametro ?lang= (pagine pubbliche senza token). */
export function langFromParam(v: string | string[] | null | undefined): Lang {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "en" ? "en" : "it";
}

/** Sceglie il testo nella lingua richiesta. */
export function tr<T>(lang: Lang, texts: Localized<T>): T {
  return texts[lang] ?? texts.it;
}

/** Locale Intl per date e importi. Inglese britannico: "30 Jun 2026", "€15.00". */
export function intlLocale(lang: Lang = "it"): string {
  return lang === "en" ? "en-GB" : "it-IT";
}

/** Locale per Stripe Checkout / preferred_locales. */
export function stripeLocale(lang: Lang): "it" | "en" {
  return lang;
}

/** Etichette per il selettore lingua nell'admin. */
export const LOCALE_LABELS: Record<Locale, string> = {
  IT: "Italiano",
  EN: "English",
};

/**
 * Nome/descrizione di un servizio nella lingua del cliente: il campo EN se
 * valorizzato, altrimenti l'italiano.
 */
export function localizedServiceName(
  service: { name: string; nameEn?: string | null },
  lang: Lang,
): string {
  return lang === "en" && service.nameEn?.trim() ? service.nameEn.trim() : service.name;
}

export function localizedServiceDescription(
  service: { description?: string | null; descriptionEn?: string | null },
  lang: Lang,
): string | null {
  if (lang === "en" && service.descriptionEn?.trim()) return service.descriptionEn.trim();
  return service.description ?? null;
}
