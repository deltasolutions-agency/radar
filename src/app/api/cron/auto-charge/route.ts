import type { NextRequest } from "next/server";
import { CRON_NAMES, handleCronRequest } from "@/lib/cron/common";
import { runAutoCharge } from "@/lib/cron/auto-charge-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/auto-charge — addebito automatico ricorrente (off_session).
//
// Le righe con rinnovo automatico scadute da al massimo 3 giorni vengono
// RAGGRUPPATE per (abbonamento, valuta, giorno di scadenza) in un unico Payment +
// una sola PaymentIntent Stripe (idempotency key per periodo). Regole complete in
// src/lib/cron/auto-charge-plan.ts. ?dryRun=1 → nessun addebito né scrittura.
export function GET(request: NextRequest) {
  return handleCronRequest(request, CRON_NAMES.autoCharge, runAutoCharge);
}
