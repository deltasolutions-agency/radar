import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";

type Params = { params: { id: string } };

// PATCH /api/costs/[id]/multi-use — interruttore rapido "più volte per cliente"
// dall'elenco Costi. Spegnendolo, ogni abbonamento torna a 1 unità.
export function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const { multiUse } = z.object({ multiUse: z.boolean() }).parse(await req.json());
    const cost = await prisma.cost.findUnique({ where: { id: params.id }, select: { general: true } });
    if (!cost) return error("Costo non trovato", 404);
    if (cost.general) return error("È un costo generale: non si richiama negli abbonamenti", 400);
    await prisma.$transaction([
      prisma.cost.update({ where: { id: params.id }, data: { multiUse } }),
      ...(multiUse
        ? []
        : [prisma.costAllocation.updateMany({ where: { costId: params.id, quantity: { gt: 1 } }, data: { quantity: 1 } })]),
    ]);
    return json({ ok: true });
  });
}
