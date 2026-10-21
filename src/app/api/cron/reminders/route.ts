import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runReminders } from "@/lib/cron/reminders-run";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
// ?dryRun=1 → stessa logica di scripts/cron-preview.ts, nessun invio/scrittura.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/reminders — ricalcolo status, reminder/preavvisi raggruppati per
// (abbonamento, scadenza, milestone), cessazioni, riepilogo admin, retention log.
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.reminders, runReminders);
}
