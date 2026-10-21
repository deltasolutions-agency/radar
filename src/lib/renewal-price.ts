import type { RenewalIncreaseMode } from "@prisma/client";

// UNICO punto di calcolo dell'aumento al rinnovo. Usato da conferma pagamento
// (rinnovo), reminder/preavvisi, checkout, pagamento manuale, auto-charge,
// pagine pubbliche, dashboard, form e cron-preview. Funzioni pure (anche lato
// client). Tutti i prezzi sono NETTI unitari: IVA e costo di servizio restano
// calcolati al momento dell'addebito come sempre.
//
// EVERY_RENEWAL (comportamento storico, invariato): il rinnovo si paga al
//   prezzo corrente; alla conferma il prezzo diventa round(p × (1 + %/100)).
//   100 → paga 100, poi 110 → paga 110, poi 121 → …
// ONCE: l'aumento si paga GIÀ al primo rinnovo (100 → paga 110), alla
//   conferma il prezzo diventa 110 e si segna renewalIncreaseAppliedAt; da lì
//   il prezzo resta bloccato (paga 110, 110, …).

export type RenewalPricingItem = {
  priceCents: number;
  renewalIncreaseMode: RenewalIncreaseMode;
  renewalIncreaseAppliedAt: Date | string | null;
  renewalIncreasePercentOverride: number | null;
  service: { renewalIncreasePercent: number };
};

/** % di aumento effettiva: override della riga, altrimenti quella del servizio. */
export function effectiveIncreasePercent(it: RenewalPricingItem): number {
  return it.renewalIncreasePercentOverride ?? it.service.renewalIncreasePercent;
}

/** Prezzo aumentato (stessa formula storica: arrotondamento al centesimo). */
export function applyIncrease(priceCents: number, percent: number): number {
  return Math.round(priceCents * (1 + percent / 100));
}

/** true se la riga ONCE deve ancora applicare (e pagare) il suo aumento. */
export function isOnceIncreasePending(it: RenewalPricingItem): boolean {
  return (
    it.renewalIncreaseMode === "ONCE" &&
    !it.renewalIncreaseAppliedAt &&
    effectiveIncreasePercent(it) > 0
  );
}

/**
 * Prezzo NETTO unitario che si paga al PROSSIMO rinnovo. EVERY_RENEWAL: il
 * prezzo corrente (invariato rispetto a prima). ONCE non ancora applicato: il
 * prezzo aumentato.
 */
export function renewalChargePriceCents(it: RenewalPricingItem): number {
  return isOnceIncreasePending(it)
    ? applyIncrease(it.priceCents, effectiveIncreasePercent(it))
    : it.priceCents;
}

/** Nuovo stato della riga alla CONFERMA del rinnovo. */
export function renewalOutcome(
  it: RenewalPricingItem,
  now: Date,
): {
  newPriceCents: number;
  /** undefined = indicatore invariato. */
  renewalIncreaseAppliedAt: Date | undefined;
  onceIncreaseApplied: boolean;
} {
  const pct = effectiveIncreasePercent(it);
  if (it.renewalIncreaseMode === "EVERY_RENEWAL") {
    return {
      newPriceCents: applyIncrease(it.priceCents, pct),
      renewalIncreaseAppliedAt: undefined,
      onceIncreaseApplied: false,
    };
  }
  if (isOnceIncreasePending(it)) {
    // Il rinnovo è stato pagato al prezzo aumentato: diventa il prezzo corrente.
    return {
      newPriceCents: applyIncrease(it.priceCents, pct),
      renewalIncreaseAppliedAt: now,
      onceIncreaseApplied: true,
    };
  }
  return {
    newPriceCents: it.priceCents,
    renewalIncreaseAppliedAt: undefined,
    onceIncreaseApplied: false,
  };
}

/** Prezzi NETTI unitari pagati ai prossimi `count` rinnovi (anteprime). */
export function upcomingRenewalPrices(it: RenewalPricingItem, count: number): number[] {
  const out: number[] = [];
  let cur: RenewalPricingItem = { ...it };
  for (let i = 0; i < count; i++) {
    out.push(renewalChargePriceCents(cur));
    const o = renewalOutcome(cur, new Date(0));
    cur = {
      ...cur,
      priceCents: o.newPriceCents,
      renewalIncreaseAppliedAt: o.renewalIncreaseAppliedAt ?? cur.renewalIncreaseAppliedAt,
    };
  }
  return out;
}

/** Descrizione leggibile della modalità di aumento di una riga. */
export function renewalIncreaseLabel(it: RenewalPricingItem): string {
  const pct = effectiveIncreasePercent(it);
  if (pct <= 0) return "nessun aumento";
  if (it.renewalIncreaseMode === "EVERY_RENEWAL") return `+${pct}% a ogni rinnovo`;
  return it.renewalIncreaseAppliedAt
    ? `+${pct}% una sola volta — già applicato, prezzo bloccato`
    : `+${pct}% una sola volta — al prossimo rinnovo, poi prezzo bloccato`;
}
