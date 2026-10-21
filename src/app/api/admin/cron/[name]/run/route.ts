import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { executeCron } from "@/lib/cron/common";
import { CRON_RUNNERS, isCronName } from "@/lib/cron/registry";
import { AUTOCHARGE_CONFIRM_WORD, PREVIEW_VALIDITY_MS } from "@/lib/cron/meta";

type Params = { params: { name: string } };

const bodySchema = z.object({
  /** Momento dell'anteprima vista dall'admin (obbligatoria e recente). */
  previewedAt: z.string(),
  /** Per l'auto-charge: la parola ADDEBITA. */
  confirm: z.string().optional(),
});

// POST /api/admin/cron/[name]/run — "Esegui ora" (solo admin). Richiede
// un'anteprima recente; per l'auto-charge la conferma "ADDEBITA". Esecuzione
// registrata in CronRun (trigger MANUAL, utente) e in AdminActionLog. Bloccata
// se lo stesso cron è già in esecuzione. Procede anche se il cron è in pausa
// (la pausa ferma solo le esecuzioni programmate).
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireAdmin();
    if (!isCronName(params.name)) return error("Cron sconosciuto", 404);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const previewedAt = new Date(body.previewedAt).getTime();
    if (!Number.isFinite(previewedAt) || Date.now() - previewedAt > PREVIEW_VALIDITY_MS) {
      return error("Prima di eseguire, genera un'anteprima aggiornata.", 400);
    }
    if (params.name === "auto-charge" && body.confirm?.trim() !== AUTOCHARGE_CONFIRM_WORD) {
      return error(`Per confermare gli addebiti scrivi ${AUTOCHARGE_CONFIRM_WORD}.`, 400);
    }

    const name = params.name;
    const outcome = await executeCron(
      name,
      () => CRON_RUNNERS[name]({ now: new Date(), dryRun: false }),
      { trigger: "MANUAL", triggeredBy: session.email, ignorePause: true },
    );

    await prisma.adminActionLog
      .create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: "CRON_MANUAL_RUN",
          entityType: "CronSetting",
          entityId: name,
          details: {
            outcome: outcome.kind,
            runId: outcome.runId,
            ...(outcome.kind === "done"
              ? {
                  sent: outcome.result.sent,
                  skipped: outcome.result.skipped,
                  failed: outcome.result.failed,
                }
              : {}),
          },
        },
      })
      .catch((e) => console.error("[cron manuale] log azione fallito:", e));

    if (outcome.kind === "locked") return error(outcome.message, 409, { runId: outcome.runId });
    if (outcome.kind === "paused") return error("Cron in pausa", 409);
    const { details: _details, ...summary } = outcome.result;
    return json({ ok: true, runId: outcome.runId, ...summary });
  });
}
