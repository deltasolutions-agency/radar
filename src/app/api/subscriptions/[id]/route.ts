import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { invalidateBeforeChange } from "@/lib/activation";
import { subscriptionUpdateSchema } from "@/lib/validations";

type Params = { params: { id: string } };

// GET /api/subscriptions/[id]  → contenitore con cliente, righe e pagamenti
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        items: { include: { service: true }, orderBy: { endDate: "asc" } },
        payments: {
          include: {
            receipt: true,
            items: {
              include: { subscriptionItem: { include: { service: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    return json({ subscription });
  });
}

// PATCH /api/subscriptions/[id]  → aggiorna il contenitore (solo note)
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const exists = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) return error("Abbonamento non trovato", 404);

    const data = subscriptionUpdateSchema.parse(await req.json());
    // Il costo di servizio cambia l'importo del primo pagamento in attesa.
    if (data.serviceFeeEnabled !== undefined) {
      const conflict = await invalidateBeforeChange(params.id, "costi di servizio modificati");
      if (conflict) return error(conflict, 409);
    }
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
        "Impossibile eliminare: l'abbonamento ha pagamenti registrati. Puoi cessarne le righe o usare l'eliminazione forzata.",
        409,
      );
    }

    // Le righe (SubscriptionItem) cascano con il contenitore; senza pagamenti
    // non ci sono PaymentItem che ne blocchino la cancellazione (Restrict).
    await prisma.subscription.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
