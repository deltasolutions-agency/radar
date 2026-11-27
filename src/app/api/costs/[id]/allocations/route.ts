import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";
import { allocationCreateSchema, toNumber } from "@/lib/costs";

type Params = { params: { id: string } };

// POST /api/costs/[id]/allocations — collega il costo a un abbonamento.
// Se è già collegato, aggiunge unità (es. un altro sito sullo stesso hosting).
// sharePercent assente/null = quota uguale del residuo (per unità).
export function POST(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const data = allocationCreateSchema.parse(await req.json());
    const [cost, sub] = await Promise.all([
      prisma.cost.findUnique({ where: { id: params.id }, include: { allocations: true } }),
      prisma.subscription.findUnique({ where: { id: data.subscriptionId }, select: { id: true } }),
    ]);
    if (!cost) return error("Costo non trovato", 404);
    if (cost.general) return error("È un costo generale: non si richiama negli abbonamenti", 400);
    if (!sub) return error("Abbonamento non trovato", 404);
    const existing = cost.allocations.find((a) => a.subscriptionId === data.subscriptionId);
    if (existing) {
      if (!cost.multiUse) return error("Costo già richiamato in questo abbonamento", 409);
      const allocation = await prisma.costAllocation.update({
        where: { id: existing.id },
        data: { quantity: { increment: data.quantity ?? 1 } },
      });
      return json({ allocation });
    }
    const share = data.sharePercent ?? null;
    if (share !== null) {
      const fixed = cost.allocations.reduce((s, a) => s + (toNumber(a.sharePercent) ?? 0), 0);
      if (fixed + share > 100.0001) {
        return error(`Le quote fissate supererebbero il 100% (già assegnato ${fixed}%)`, 400);
      }
    }
    const allocation = await prisma.costAllocation.create({
      data: { costId: cost.id, subscriptionId: sub.id, sharePercent: share, quantity: cost.multiUse ? (data.quantity ?? 1) : 1 },
    });
    return json({ allocation }, 201);
  });
}
