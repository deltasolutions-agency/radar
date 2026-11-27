import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runCostRenewals } from "@/lib/cron/cost-renewals-run";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
// ?dryRun=1 → stessa logica, nessun invio/scrittura.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/cost-renewals — rinnova le date dei costi ricorrenti e avvisa
// hello@ dei costi che si rinnovano entro 7 giorni (ogni giorno, alle 10:00).
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.costRenewals, runCostRenewals);
}
