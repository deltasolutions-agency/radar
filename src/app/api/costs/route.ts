import { prisma } from "@/lib/prisma";
import { json, withApi, requireAdmin } from "@/lib/api";
import { costSchemaChecked as costSchema, dayFromYmd } from "@/lib/costs";

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
        vatPercent: data.vatPercent,
        general: data.general,
        recurring: data.recurring,
        renewalDate: data.renewalDate ? dayFromYmd(data.renewalDate) : null,
        notes: data.notes ?? null,
        active: data.active ?? true,
        createdBy: session.email ?? null,
      },
    });
    return json({ cost }, 201);
  });
}

// GET /api/costs — costi in uso, per richiamarli nel form del nuovo abbonamento.
export function GET() {
  return withApi(async () => {
    await requireAdmin();
    const costs = await prisma.cost.findMany({
      where: { active: true, general: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        supplier: true,
        amountCents: true,
        periodMonths: true,
        vatPercent: true,
        allocations: { select: { quantity: true } },
      },
    });
    // Unità già richiamate (somma delle quantità), per l'anteprima della quota.
    return json({
      costs: costs.map(({ allocations, ...c }) => ({ ...c, units: allocations.reduce((s, a) => s + a.quantity, 0) })),
    });
  });
}
