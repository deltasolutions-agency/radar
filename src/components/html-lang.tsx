"use client";

import { useEffect } from "react";
import type { Lang } from "@/lib/i18n";

/**
 * Imposta `lang` sull'<html> per le pagine pubbliche (il root layout ha
 * lang="it" fisso). Non produce markup; al cambio pagina ripristina il valore
 * precedente.
 */
export function HtmlLang({ lang }: { lang: Lang }) {
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.lang;
    el.lang = lang;
    return () => {
      el.lang = prev;
    };
  }, [lang]);
  return null;
}
