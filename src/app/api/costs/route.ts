import { prisma } from "@/lib/prisma";
import { json, withApi, requireAdmin } from "@/lib/api";
import { costSchema, dayFromYmd } from "@/lib/costs";

// POST /api/costs — nuovo costo (Amministrazione → Costi). Solo admin.
export function POST(req: Request) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = costSchema.parse(await req.json());
    const cost = await prisma.cost.create({
      data: {
        name: data.name,
        supplier: data.supplier ?? null,
        category: data.category ?? null,
        amountCents: data.amountCents,
        periodMonths: data.periodMonths,
        renewalDate: data.renewalDate ? dayFromYmd(data.renewalDate) : null,
        notes: data.notes ?? null,
        active: data.active ?? true,
        createdBy: session.email ?? null,
      },
    });
    return json({ cost }, 201);
  });
}
