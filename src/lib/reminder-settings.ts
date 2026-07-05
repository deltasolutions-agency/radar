import "server-only";
import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReminderOverride } from "@/lib/email-templates";

/** Soglie temporali risolte dei reminder (con i default di fabbrica). */
export type ReminderThresholds = {
  thresholdsLongDays: number[];
  thresholdsShortDays: number[];
  overdueDays: number[];
  cessationDay: number;
};

/** Valori di default (coincidono con i @default dello schema Prisma). */
export const DEFAULT_REMINDER_THRESHOLDS: ReminderThresholds = {
  thresholdsLongDays: [30, 15, 7],
  thresholdsShortDays: [10, 5, 1],
  overdueDays: [0, 1, 2, 7, 10],
  cessationDay: 11,
};

/** Soglie orarie di default per i solleciti di attivazione rinnovo automatico. */
export const DEFAULT_AUTOCHARGE_REMINDER_HOURS = [12, 24];

export const SETTINGS_SINGLETON_ID = "singleton";

/**
 * Carica le soglie orarie dei solleciti di attivazione (autoChargeReminderHours),
 * con fallback ai default se il record non esiste o l'array è vuoto. Non lancia.
 */
export async function loadAutoChargeReminderHours(): Promise<number[]> {
  try {
    const s = await prisma.reminderSettings.findUnique({
      where: { id: SETTINGS_SINGLETON_ID },
      select: { autoChargeReminderHours: true },
    });
    const arr = s?.autoChargeReminderHours;
    return arr && arr.length > 0 ? arr : DEFAULT_AUTOCHARGE_REMINDER_HOURS;
  } catch (e) {
    console.error(
      "[reminder-settings] load autoChargeReminderHours fallito, uso default:",
      e,
    );
    return DEFAULT_AUTOCHARGE_REMINDER_HOURS;
  }
}

/**
 * Carica le soglie reminder dal record singleton, con fallback ai default se il
 * record non esiste ancora o un array è vuoto/nullo. Non lancia mai.
 */
export async function loadReminderThresholds(): Promise<ReminderThresholds> {
  try {
    const s = await prisma.reminderSettings.findUnique({
      where: { id: SETTINGS_SINGLETON_ID },
    });
    if (!s) return DEFAULT_REMINDER_THRESHOLDS;
    const nonEmpty = (arr: number[], fallback: number[]) =>
      arr && arr.length > 0 ? arr : fallback;
    return {
      thresholdsLongDays: nonEmpty(
        s.thresholdsLongDays,
        DEFAULT_REMINDER_THRESHOLDS.thresholdsLongDays,
      ),
      thresholdsShortDays: nonEmpty(
        s.thresholdsShortDays,
        DEFAULT_REMINDER_THRESHOLDS.thresholdsShortDays,
      ),
      overdueDays: nonEmpty(
        s.overdueDays,
        DEFAULT_REMINDER_THRESHOLDS.overdueDays,
      ),
      cessationDay: s.cessationDay ?? DEFAULT_REMINDER_THRESHOLDS.cessationDay,
    };
  } catch (e) {
    console.error("[reminder-settings] load soglie fallito, uso default:", e);
    return DEFAULT_REMINDER_THRESHOLDS;
  }
}

/** Mappa type → override testuale, dai record ReminderTemplate. */
export type ReminderTemplateMap = Partial<
  Record<NotificationType, ReminderOverride>
>;

/**
 * Carica gli override testuali per tipo (subject/body). Non lancia mai: in caso
 * di errore ritorna una mappa vuota (→ tutti i default).
 */
export async function loadReminderTemplates(): Promise<ReminderTemplateMap> {
  try {
    const rows = await prisma.reminderTemplate.findMany();
    const map: ReminderTemplateMap = {};
    for (const r of rows) {
      map[r.type] = { subject: r.subject, body: r.body };
    }
    return map;
  } catch (e) {
    console.error("[reminder-settings] load template fallito, uso default:", e);
    return {};
  }
}
