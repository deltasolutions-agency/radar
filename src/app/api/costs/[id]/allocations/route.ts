import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { allocationCreateSchema, toNumber } from "@/lib/costs";

type Params = { params: { id: string } };

// POST /api/costs/[id]/allocations — collega il costo a un abbonamento.
// sharePercent assente/null = quota uguale del residuo.
export function POST(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const data = allocationCreateSchema.parse(await req.json());
    const [cost, sub] = await Promise.all([
      prisma.cost.findUnique({ where: { id: params.id }, include: { allocations: true } }),
      prisma.subscription.findUnique({ where: { id: data.subscriptionId }, select: { id: true } }),
    ]);
    if (!cost) return error("Costo non trovato", 404);
    if (!sub) return error("Abbonamento non trovato", 404);
    if (cost.allocations.some((a) => a.subscriptionId === data.subscriptionId)) {
      return error("Costo già collegato a questo abbonamento", 409);
    }
    const share = data.sharePercent ?? null;
    if (share !== null) {
      const fixed = cost.allocations.reduce((s, a) => s + (toNumber(a.sharePercent) ?? 0), 0);
      if (fixed + share > 100.0001) {
        return error(`Le quote fissate supererebbero il 100% (già assegnato ${fixed}%)`, 400);
      }
    }
    const allocation = await prisma.costAllocation.create({
      data: { costId: cost.id, subscriptionId: sub.id, sharePercent: share },
    });
    return json({ allocation }, 201);
  });
}
