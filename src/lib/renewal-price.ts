import type { RenewalIncreaseMode } from "@prisma/client";

// UNICO punto di calcolo dell'aumento al rinnovo. Usato da conferma pagamento
// (rinnovo), reminder/preavvisi, checkout, pagamento manuale, auto-charge,
// pagine pubbliche, dashboard, form e cron-preview. Funzioni pure (anche lato
// client). Tutti i prezzi sono NETTI unitari: IVA e costo di servizio restano
// calcolati al momento dell'addebito come sempre.
//
// In entrambe le modalità l'aumento si paga GIÀ al rinnovo: si paga
// round(p × (1 + %/100)) e alla conferma quel prezzo diventa il corrente.
// EVERY_RENEWAL: ogni rinnovo riapplica la % (100 → paga 110, 121, 133,10 …).
// ONCE: solo il primo rinnovo (100 → paga 110), alla conferma si segna
//   renewalIncreaseAppliedAt e da lì il prezzo resta bloccato (110, 110, …).

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

/** true se il PROSSIMO rinnovo paga un aumento (EVERY_RENEWAL sempre, ONCE se non applicato). */
export function isIncreaseDueAtRenewal(it: RenewalPricingItem): boolean {
  if (effectiveIncreasePercent(it) <= 0) return false;
  return it.renewalIncreaseMode === "EVERY_RENEWAL" || isOnceIncreasePending(it);
}

/**
 * Prezzo NETTO unitario che si paga al PROSSIMO rinnovo: prezzo corrente
 * aumentato se l'aumento è dovuto, altrimenti il prezzo corrente.
 */
export function renewalChargePriceCents(it: RenewalPricingItem): number {
  return isIncreaseDueAtRenewal(it)
    ? applyIncrease(it.priceCents, effectiveIncreasePercent(it))
    : it.priceCents;
}

/**
 * Nuovo stato della riga alla CONFERMA del rinnovo: il prezzo pagato
 * (renewalChargePriceCents) diventa il prezzo corrente. Va chiamata UNA volta
 * per rinnovo (confirmPaymentAndRenew è idempotente sul Payment).
 */
export function renewalOutcome(
  it: RenewalPricingItem,
  now: Date,
): {
  newPriceCents: number;
  /** undefined = indicatore invariato. */
  renewalIncreaseAppliedAt: Date | undefined;
  onceIncreaseApplied: boolean;
} {
  const onceIncreaseApplied = isOnceIncreasePending(it);
  return {
    newPriceCents: renewalChargePriceCents(it),
    renewalIncreaseAppliedAt: onceIncreaseApplied ? now : undefined,
    onceIncreaseApplied,
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
  if (it.renewalIncreaseMode === "EVERY_RENEWAL") return `+${pct}% a ogni rinnovo (già dal prossimo)`;
  return it.renewalIncreaseAppliedAt
    ? `+${pct}% una sola volta — già applicato, prezzo bloccato`
    : `+${pct}% una sola volta — al prossimo rinnovo, poi prezzo bloccato`;
}
