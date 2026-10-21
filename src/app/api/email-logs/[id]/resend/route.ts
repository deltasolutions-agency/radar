import type { NextRequest } from "next/server";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { resendEmailLog } from "@/lib/send-email";

type Params = { params: { id: string } };

// POST /api/email-logs/[id]/resend — reinvia un'email registrata (solo admin).
// Crea un NUOVO EmailLog con trigger MANUAL e senza dedupeKey.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const result = await resendEmailLog(params.id);
    if (!result) return error("Email non trovata", 404);
    if (!result.ok) {
      return error(`Invio non riuscito: ${result.error ?? "errore"}`, 502, {
        logId: result.logId,
      });
    }
    return json({ ok: true, logId: result.logId });
  });
}
