import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { costSchema, dayFromYmd } from "@/lib/costs";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";

type Params = { params: { id: string } };

// PATCH /api/costs/[id] — modifica un costo.
export function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const exists = await prisma.cost.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) return error("Costo non trovato", 404);
    const data = costSchema.parse(await req.json());
    const cost = await prisma.cost.update({
      where: { id: params.id },
      data: {
        name: data.name,
        supplier: data.supplier ?? null,
        category: data.category ?? null,
        amountCents: data.amountCents,
        periodMonths: data.periodMonths,
        vatPercent: data.vatPercent,
        renewalDate: data.renewalDate ? dayFromYmd(data.renewalDate) : null,
        notes: data.notes ?? null,
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
    return json({ cost });
  });
}

// DELETE /api/costs/[id] — elimina il costo e i suoi collegamenti.
export function DELETE(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { confirmText?: string };
    if (body.confirmText?.trim() !== DELETE_CONFIRM_WORD) return error(`Scrivi ${DELETE_CONFIRM_WORD} per confermare`, 400);
    const exists = await prisma.cost.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) return error("Costo non trovato", 404);
    await prisma.cost.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
