import { NotificationType, BillingPeriod } from "@prisma/client";
import {
  DEFAULT_REMINDER_THRESHOLDS,
  type ReminderThresholds,
} from "@/lib/reminder-settings";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Type di pre-scadenza in ordine (dal più lontano al più vicino): le soglie
// configurate vengono mappate posizionalmente su questi tre type.
const PRE_EXPIRY_TYPES: NotificationType[] = [
  "PROMEMORIA_30",
  "PROMEMORIA_15",
  "PROMEMORIA_7",
];

/** Costruisce la mappa giorni→type dalle soglie configurate (max 3, posizionali). */
function buildPreExpiryMap(days: number[]): Record<number, NotificationType> {
  const map: Record<number, NotificationType> = {};
  days.slice(0, PRE_EXPIRY_TYPES.length).forEach((d, i) => {
    map[d] = PRE_EXPIRY_TYPES[i];
  });
  return map;
}

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
export function getReminderMilestone(
  item: {
    endDate: Date;
    billingPeriod: BillingPeriod;
    customPeriodDays: number | null;
  },
  settings: ReminderThresholds = DEFAULT_REMINDER_THRESHOLDS,
): ReminderMilestone | null {
  const now = new Date();
  const diffDays = Math.ceil(
    (item.endDate.getTime() - now.getTime()) / MS_PER_DAY,
  );

  // ── PRE-SCADENZA ──────────────────────────────────────────────────────────
  if (diffDays > 0) {
    const days = isShortPeriod(item.billingPeriod, item.customPeriodDays)
      ? settings.thresholdsShortDays
      : settings.thresholdsLongDays;
    const type = buildPreExpiryMap(days)[diffDays];
    return type ? { type, isCessationTrigger: false } : null;
  }

  // ── POST-SCADENZA (o giorno stesso) ──────────────────────────────────────
  const diffDaysAfter = -diffDays; // 0 = scade oggi, 1 = scaduto da 1 giorno, ...

  if (diffDaysAfter === settings.cessationDay) {
    return { type: "CESSAZIONE_MOROSITA", isCessationTrigger: true };
  }

  if (settings.overdueDays.includes(diffDaysAfter)) {
    return { type: "SOLLECITO", isCessationTrigger: false };
  }

  // Nessuna milestone oggi.
  return null;
}
