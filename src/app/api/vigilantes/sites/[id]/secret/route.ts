import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { generateSecret } from "@/lib/vigilantes/protocol";

// POST /api/vigilantes/sites/:id/secret — rigenera il secret. La vecchia
// chiave smette subito di funzionare: va incollata la nuova nel plugin.
export function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const session = await requireAdmin();
    const res = await prisma.wpSite.updateMany({ where: { id: params.id }, data: { secret: generateSecret() } });
    if (res.count === 0) return error("Sito non trovato", 404);
    await prisma.adminActionLog.create({
      data: {
        userId: session.sub,
        userEmail: session.email,
        action: "VIGILANTES_SECRET_ROTATE",
        entityType: "WpSite",
        entityId: params.id,
      },
    });
    return json({ ok: true });
  });
}
