import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runActivationReminders } from "@/lib/cron/activation-reminders-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/autocharge-reminders — solleciti di ATTIVAZIONE del rinnovo
// automatico (soglie orarie configurabili) ed escalation admin, raggruppati per
// cliente, con ritentativi sugli invii falliti. Regole in
// src/lib/cron/activation-reminders.ts. ?dryRun=1 → nessun invio né scrittura.
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.activationReminders, runActivationReminders);
}
