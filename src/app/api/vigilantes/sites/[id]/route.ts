import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";
import { siteUpdateSchema } from "@/lib/vigilantes/validations";

type Ctx = { params: { id: string } };

// PATCH /api/vigilantes/sites/:id — nome, URL, cliente, note, pausa. Solo admin.
export function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const current = await prisma.wpSite.findUnique({ where: { id: params.id } });
    if (!current) return error("Sito non trovato", 404);
    const d = siteUpdateSchema.parse(await req.json());
    if (d.url && d.url !== current.url && (await prisma.wpSite.findUnique({ where: { url: d.url } }))) {
      return error("Un altro sito usa già questo URL", 409);
    }
    if (d.clientId && !(await prisma.client.findUnique({ where: { id: d.clientId } }))) {
      return error("Cliente non trovato", 400);
    }
    const site = await prisma.wpSite.update({ where: { id: params.id }, data: d, select: { id: true } });
    return json({ site });
  });
}

// DELETE /api/vigilantes/sites/:id — rimuove sito, componenti e alert.
// Conferma testuale "ELIMINA". Il plugin sul sito smette di essere accettato.
export function DELETE(req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { confirmText?: string };
    if ((body.confirmText ?? "").trim() !== DELETE_CONFIRM_WORD) {
      return error(`Scrivi ${DELETE_CONFIRM_WORD} per confermare`, 400);
    }
    const res = await prisma.wpSite.deleteMany({ where: { id: params.id } });
    if (res.count === 0) return error("Sito non trovato", 404);
    return json({ ok: true });
  });
}
