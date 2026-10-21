import type { NextRequest } from "next/server";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { CRON_RUNNERS, isCronName } from "@/lib/cron/registry";

type Params = { params: { name: string } };

// POST /api/admin/cron/[name]/preview — anteprima (stessa logica di ?dryRun=1):
// nessun invio, addebito o scrittura. Funziona anche con il cron in pausa.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    if (!isCronName(params.name)) return error("Cron sconosciuto", 404);
    const result = await CRON_RUNNERS[params.name]({ now: new Date(), dryRun: true });
    return json({ ...result, previewedAt: new Date().toISOString() });
  });
}
