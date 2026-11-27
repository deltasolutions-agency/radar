import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { allocationUpdateSchema, toNumber } from "@/lib/costs";

type Params = { params: { id: string } };

// PATCH /api/cost-allocations/[id] — cambia quantità (unità) o quota (null = quota uguale).
export function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const current = await prisma.costAllocation.findUnique({
      where: { id: params.id },
      include: { cost: { include: { allocations: true } } },
    });
    if (!current) return error("Collegamento non trovato", 404);
    const { sharePercent, quantity } = allocationUpdateSchema.parse(await req.json());
    if (sharePercent !== undefined && sharePercent !== null) {
      const others = current.cost.allocations
        .filter((a) => a.id !== current.id)
        .reduce((s, a) => s + (toNumber(a.sharePercent) ?? 0), 0);
      if (others + sharePercent > 100.0001) {
        return error(`Le quote fissate supererebbero il 100% (altri abbonamenti: ${others}%)`, 400);
      }
    }
    const allocation = await prisma.costAllocation.update({
      where: { id: params.id },
      data: {
        ...(sharePercent !== undefined ? { sharePercent } : {}),
        ...(quantity !== undefined ? { quantity } : {}),
      },
    });
    return json({ allocation });
  });
}

// DELETE /api/cost-allocations/[id] — scollega il costo dall'abbonamento.
export function DELETE(_req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const exists = await prisma.costAllocation.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) return error("Collegamento non trovato", 404);
    await prisma.costAllocation.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
