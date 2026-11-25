import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { checkSite } from "@/lib/vigilantes/pull";
import { ignorePathSchema } from "@/lib/vigilantes/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/vigilantes/sites/:id/ignore — { path } segna un file come innocuo
// (escluso dagli alert di sicurezza); { path, undo: true } lo toglie. Poi
// ricontrolla il sito, così gli alert si aggiornano subito. Solo admin.
export function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const session = await requireAdmin();
    const { path, undo } = ignorePathSchema.parse(await req.json());
    const site = await prisma.wpSite.findUnique({ where: { id: params.id } });
    if (!site) return error("Sito non trovato", 404);
    const next = undo
      ? site.ignoredPaths.filter((p) => p !== path)
      : Array.from(new Set([...site.ignoredPaths, path])).slice(0, 500);
    const updated = await prisma.wpSite.update({ where: { id: site.id }, data: { ignoredPaths: next } });
    await prisma.adminActionLog.create({
      data: {
        userId: session.sub,
        userEmail: session.email,
        action: undo ? "VIGILANTES_UNIGNORE_PATH" : "VIGILANTES_IGNORE_PATH",
        entityType: "WpSite",
        entityId: site.id,
        details: { path },
      },
    });
    const result = await checkSite(updated, { retry: false, trigger: "MANUAL" });
    return json({ ignoredPaths: next, result });
  });
}
