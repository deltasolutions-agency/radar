import "server-only";
import type { CronName, CronResult } from "@/lib/cron/common";
import { runReminders } from "@/lib/cron/reminders-run";
import { runAutoCharge } from "@/lib/cron/auto-charge-run";
import { runActivationReminders } from "@/lib/cron/activation-reminders-run";
import { runLedgerAlerts } from "@/lib/cron/ledger-alerts-run";

type Runner = (opts: { now: Date; dryRun: boolean }) => Promise<CronResult>;

/** Esecutori dei cron per nome (route programmate e azioni dalla dashboard). */
export const CRON_RUNNERS: Record<CronName, Runner> = {
  reminders: runReminders,
  "auto-charge": runAutoCharge,
  "autocharge-reminders": runActivationReminders,
  "ledger-alerts": runLedgerAlerts,
};

export function isCronName(name: string): name is CronName {
  return Object.prototype.hasOwnProperty.call(CRON_RUNNERS, name);
}
