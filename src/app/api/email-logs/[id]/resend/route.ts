import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { resendEmailLog } from "@/lib/send-email";

type Params = { params: { id: string } };

const bodySchema = z.object({
  recipients: z.array(z.string()).min(1, "Indica almeno un destinatario").max(20),
});

// POST /api/email-logs/[id]/resend — reinvia lo snapshot di un'email (solo
// admin) ai destinatari indicati. Nuovo EmailLog MANUAL, senza dedupeKey,
// collegato all'originale. Non aggiorna l'anagrafica del cliente.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const { recipients } = bodySchema.parse(await req.json().catch(() => ({})));
    const outcome = await resendEmailLog(params.id, recipients);
    switch (outcome.kind) {
      case "not_found":
        return error("Email non trovata", 404);
      case "not_resendable":
        return error("Solo le email inviate o fallite possono essere reinviate", 400);
      case "invalid":
        return error(`Destinatari non validi: ${outcome.invalid.join(", ")}`, 400, {
          invalid: outcome.invalid,
        });
      case "sent":
        if (!outcome.result.ok) {
          return error(`Invio non riuscito: ${outcome.result.error ?? "errore"}`, 502, {
            logId: outcome.result.logId,
          });
        }
        return json({ ok: true, logId: outcome.result.logId });
    }
  });
}
