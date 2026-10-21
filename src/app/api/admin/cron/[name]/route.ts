import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { getCronSetting } from "@/lib/cron/common";
import { isCronName } from "@/lib/cron/registry";

type Params = { params: { name: string } };

const bodySchema = z.object({ enabled: z.boolean() });

// PATCH /api/admin/cron/[name] — attiva / mette in pausa un cron (solo admin).
// L'azione viene registrata in AdminActionLog.
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireAdmin();
    if (!isCronName(params.name)) return error("Cron sconosciuto", 404);
    const { enabled } = bodySchema.parse(await req.json().catch(() => ({})));
    const before = await getCronSetting(params.name);
    const [setting] = await prisma.$transaction([
      prisma.cronSetting.update({
        where: { name: params.name },
        data: { enabled, updatedBy: session.email },
      }),
      prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: enabled ? "CRON_RESUME" : "CRON_PAUSE",
          entityType: "CronSetting",
          entityId: params.name,
          details: { from: before.enabled, to: enabled },
        },
      }),
    ]);
    return json({ ok: true, enabled: setting.enabled });
  });
}
