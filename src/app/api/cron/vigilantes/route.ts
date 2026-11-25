import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runVigilantes } from "@/lib/cron/vigilantes-run";

// Chiamato da crontab via curl con Bearer CRON_SECRET: nessuna sessione utente.
// ?dryRun=1 → elenco dei siti, nessuna chiamata/scrittura/invio.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/vigilantes — controlla i siti WordPress e invia il riepilogo.
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.vigilantes, runVigilantes);
}
