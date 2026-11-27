import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";

type Params = { params: { id: string } };

// PATCH /api/costs/[id]/recurring — attiva/disattiva "Ricorrente" dall'elenco.
export function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    await requireAdmin();
    const { recurring } = z.object({ recurring: z.boolean() }).parse(await req.json());
    const cost = await prisma.cost.findUnique({ where: { id: params.id }, select: { renewalDate: true } });
    if (!cost) return error("Costo non trovato", 404);
    if (recurring && !cost.renewalDate) return error("Indica prima la data del prossimo rinnovo (Modifica)", 400);
    await prisma.cost.update({ where: { id: params.id }, data: { recurring } });
    return json({ ok: true });
  });
}
