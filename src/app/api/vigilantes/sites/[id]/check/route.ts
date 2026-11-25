import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { checkSite } from "@/lib/vigilantes/pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/vigilantes/sites/:id/check — "Controlla ora" (un solo tentativo).
export function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await requireAdmin();
    const site = await prisma.wpSite.findUnique({ where: { id: params.id } });
    if (!site) return error("Sito non trovato", 404);
    const result = await checkSite(site, { retry: false, trigger: "MANUAL" });
    return json({ result });
  });
}
