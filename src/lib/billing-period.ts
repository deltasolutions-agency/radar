import type { BillingPeriod } from "@prisma/client";

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Durata del periodo in giorni dal billingPeriod (snapshot subscription):
 * MENSILE → 30, ANNUALE → 365, PERSONALIZZATA → customPeriodDays (null se assente).
 * Condiviso da confirm-payment (rinnovo) e payment-checkout (periodo coperto).
 */
export function periodDurationDays(sub: {
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
}): number | null {
  switch (sub.billingPeriod) {
    case "MENSILE":
      return 30;
    case "ANNUALE":
      return 365;
    case "PERSONALIZZATA":
      return sub.customPeriodDays ?? null;
    default:
      return null;
  }
}

type PeriodItem = {
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
  calendarAnchorDay?: number | null;
};

/** Stesso giorno del mese dopo `months` mesi; nei mesi più corti l'ultimo giorno. Date a mezzanotte UTC. */
export function addMonthsAnchored(d: Date, months: number, anchorDay: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, last)));
}

function anchoredMonths(it: PeriodItem): number | null {
  if (!it.calendarAnchorDay) return null;
  return it.billingPeriod === "MENSILE" ? 1 : it.billingPeriod === "ANNUALE" ? 12 : null;
}

/**
 * Fine del periodo successivo a quello che termina `endDate` (endDate = ultimo giorno coperto).
 * Con calendarAnchorDay (abbonamenti della console) segue i mesi di calendario, altrimenti
 * endDate + durata. null se la durata non è nota (PERSONALIZZATA senza giorni).
 */
export function nextPeriodEnd(it: PeriodItem, endDate: Date): Date | null {
  const months = anchoredMonths(it);
  if (months) {
    const nextStart = new Date(endDate.getTime() + MS_PER_DAY);
    return new Date(addMonthsAnchored(nextStart, months, it.calendarAnchorDay!).getTime() - MS_PER_DAY);
  }
  const d = periodDurationDays(it);
  return d == null ? null : new Date(endDate.getTime() + d * MS_PER_DAY);
}

/** Fine del primo periodo che inizia `start` con giorno fisso del mese = giorno di `start`. */
export function firstAnchoredEnd(billingPeriod: BillingPeriod, customPeriodDays: number | null, start: Date): Date | null {
  const months = billingPeriod === "MENSILE" ? 1 : billingPeriod === "ANNUALE" ? 12 : null;
  if (months) return new Date(addMonthsAnchored(start, months, start.getUTCDate()).getTime() - MS_PER_DAY);
  const d = periodDurationDays({ billingPeriod, customPeriodDays });
  return d == null ? null : new Date(start.getTime() + (d - 1) * MS_PER_DAY);
}

/**
 * Data di fine del PRIMO periodo con la convenzione del rinnovo: inizio +
 * durata − 1 giorno (es. ANNUALE 2026-10-22 → 2027-10-21). Date YYYY-MM-DD.
 * null per PERSONALIZZATA (nessuna precompilazione) o data non valida.
 */
export function conventionalEndDate(
  startYmd: string,
  billingPeriod: string,
): string | null {
  if (billingPeriod !== "MENSILE" && billingPeriod !== "ANNUALE") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return null;
  const start = new Date(`${startYmd}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const days = periodDurationDays({ billingPeriod, customPeriodDays: null })!;
  return new Date(start.getTime() + (days - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}
