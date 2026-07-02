import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionUpdateSchema } from "@/lib/validations";

type Params = { params: { id: string } };

// GET /api/subscriptions/[id]  → singolo (client, service, payments inclusi)
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        service: true,
        payments: {
          include: { receipt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    return json({ subscription });
  });
}

// PATCH /api/subscriptions/[id]
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const exists = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) return error("Abbonamento non trovato", 404);

    const data = subscriptionUpdateSchema.parse(await req.json());
    const subscription = await prisma.subscription.update({
      where: { id: params.id },
      data,
    });
    return json({ subscription });
  });
}

// DELETE /api/subscriptions/[id]  → solo se nessun pagamento collegato
export function DELETE(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { payments: true } } },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    if (subscription._count.payments > 0) {
      return error(
        "Impossibile eliminare: l'abbonamento ha pagamenti registrati. Puoi cessarlo invece.",
        409,
      );
    }

    await prisma.subscription.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
