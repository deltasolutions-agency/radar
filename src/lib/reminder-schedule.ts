import { NotificationType, BillingPeriod } from "@prisma/client";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Un periodo è "corto" (MENSILE, o PERSONALIZZATA < 60gg / null) oppure "lungo"
 * (ANNUALE, o PERSONALIZZATA >= 60gg). Determina la scala delle soglie di
 * pre-scadenza — coerente con la soglia dinamica di computeSubscriptionStatus.
 */
function isShortPeriod(
  billingPeriod: BillingPeriod,
  customPeriodDays: number | null,
): boolean {
  if (billingPeriod === "ANNUALE") return false;
  if (billingPeriod === "PERSONALIZZATA") {
    return !(customPeriodDays != null && customPeriodDays >= 60);
  }
  // MENSILE (e ogni altro caso) → corto.
  return true;
}

/**
 * Mappa: giorni-mancanti-alla-scadenza → NotificationType, per periodi lunghi.
 */
const PRE_EXPIRY_LONG: Record<number, NotificationType> = {
  30: "PROMEMORIA_30",
  15: "PROMEMORIA_15",
  7: "PROMEMORIA_7",
};

/**
 * Mappa riscalata per periodi corti: soglie più ravvicinate ma STESSI type.
 */
const PRE_EXPIRY_SHORT: Record<number, NotificationType> = {
  10: "PROMEMORIA_30",
  5: "PROMEMORIA_15",
  1: "PROMEMORIA_7",
};

/** Giorni-dopo-la-scadenza in cui inviare un SOLLECITO. */
const REMINDER_AFTER_DAYS = [0, 1, 2, 7, 10];

/** Giorno-dopo-la-scadenza in cui scatta la cessazione per morosità. */
const CESSATION_AFTER_DAYS = 11;

export type ReminderMilestone = {
  type: NotificationType;
  /** true solo per il trigger degli 11 giorni: il chiamante deve anche cessare. */
  isCessationTrigger: boolean;
};

/**
 * Determina se oggi cade su una milestone di reminder per questa riga di
 * servizio (SubscriptionItem).
 *
 * - diffDays = giorni mancanti a endDate (Math.ceil sulla differenza in ms,
 *   come computeItemStatus)
 * - diffDaysAfter = giorni trascorsi da endDate = -diffDays
 *
 * Ritorna null se oggi non è una milestone.
 */
export function getReminderMilestone(item: {
  endDate: Date;
  billingPeriod: BillingPeriod;
  customPeriodDays: number | null;
}): ReminderMilestone | null {
  const now = new Date();
  const diffDays = Math.ceil(
    (item.endDate.getTime() - now.getTime()) / MS_PER_DAY,
  );

  // ── PRE-SCADENZA ──────────────────────────────────────────────────────────
  if (diffDays > 0) {
    const table = isShortPeriod(item.billingPeriod, item.customPeriodDays)
      ? PRE_EXPIRY_SHORT
      : PRE_EXPIRY_LONG;
    const type = table[diffDays];
    return type ? { type, isCessationTrigger: false } : null;
  }

  // ── POST-SCADENZA (o giorno stesso) ──────────────────────────────────────
  const diffDaysAfter = -diffDays; // 0 = scade oggi, 1 = scaduto da 1 giorno, ...

  if (diffDaysAfter === CESSATION_AFTER_DAYS) {
    return { type: "CESSAZIONE_MOROSITA", isCessationTrigger: true };
  }

  if (REMINDER_AFTER_DAYS.includes(diffDaysAfter)) {
    return { type: "SOLLECITO", isCessationTrigger: false };
  }

  // Oltre 11 giorni (o giorni intermedi non elencati) → nessuna azione.
  return null;
}
