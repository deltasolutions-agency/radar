import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runLedgerAlerts } from "@/lib/cron/ledger-alerts-run";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
// ?dryRun=1 → stessa logica, nessun invio/scrittura.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/ledger-alerts — Amministrazione: alert a hello@ per crediti e
// debiti aperti oltre la scadenza (giorno dopo, poi ogni 7 giorni).
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.ledgerAlerts, runLedgerAlerts);
}
