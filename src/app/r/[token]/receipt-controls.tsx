"use client";

import { useCallback, useEffect, useRef } from "react";
import { tr, type Lang } from "@/lib/i18n";

const PAPER_ID = "rcpt-paper";

/**
 * Pulsanti "Ristampa" e "Stampa / PDF" e avvio dell'animazione ~450ms dopo il
 * caricamento. Lo scontrino è renderizzato dal server component: qui si
 * aggiunge/rimuove solo la classe .printing.
 */
export function ReceiptControls({ lang = "it" }: { lang?: Lang }) {
  const timer = useRef<number | undefined>(undefined);

  const start = useCallback((delay: number) => {
    const paper = document.getElementById(PAPER_ID);
    if (!paper) return;
    // Navigazione client-side: lo script inline non è stato eseguito.
    paper.closest(".rcpt-page")?.classList.add("rcpt-js");
    window.clearTimeout(timer.current);
    paper.classList.remove("printing");
    timer.current = window.setTimeout(() => paper.classList.add("printing"), delay);
  }, []);

  useEffect(() => {
    start(450);
    return () => window.clearTimeout(timer.current);
  }, [start]);

  return (
    <div className="rcpt-actions">
      <button type="button" className="rcpt-btn rcpt-btn-ghost" onClick={() => start(80)}>
        {tr(lang, { it: "Ristampa", en: "Reprint" })}
      </button>
      <button type="button" className="rcpt-btn rcpt-btn-primary" onClick={() => window.print()}>
        {tr(lang, { it: "Stampa / PDF", en: "Print / PDF" })}
      </button>
    </div>
  );
}
