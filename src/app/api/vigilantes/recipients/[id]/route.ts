import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { recipientModeSchema } from "@/lib/vigilantes/validations";

type Ctx = { params: { id: string } };

// PATCH /api/vigilantes/recipients/:id — cambia cosa riceve. Solo admin.
export function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const { mode } = z.object({ mode: recipientModeSchema }).parse(await req.json());
    const res = await prisma.wpAlertRecipient.updateMany({ where: { id: params.id }, data: { mode } });
    if (res.count === 0) return error("Destinatario non trovato", 404);
    return json({ ok: true });
  });
}

// DELETE /api/vigilantes/recipients/:id — rimuove il destinatario. Solo admin.
export function DELETE(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const res = await prisma.wpAlertRecipient.deleteMany({ where: { id: params.id } });
    if (res.count === 0) return error("Destinatario non trovato", 404);
    return json({ ok: true });
  });
}
