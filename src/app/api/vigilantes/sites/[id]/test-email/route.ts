import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { sendTestEmail } from "@/lib/vigilantes/notify";

export const runtime = "nodejs";

// POST /api/vigilantes/sites/:id/test-email — email di prova a hello@ e ai destinatari del sito.
export function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await requireAdmin();
    const site = await prisma.wpSite.findUnique({ where: { id: params.id } });
    if (!site) return error("Sito non trovato", 404);
    return json({ results: await sendTestEmail(site) });
  });
}
