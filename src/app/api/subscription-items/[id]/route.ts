import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionItemUpdateSchema } from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";

type Params = { params: { id: string } };

// GET /api/subscription-items/[id]  → singola riga con servizio
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const item = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
      include: { service: true },
    });
    if (!item) return error("Riga non trovata", 404);
    return json({ item });
  });
}

// PATCH /api/subscription-items/[id]  → modifica una riga di servizio
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const existing = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
    });
    if (!existing) return error("Riga non trovata", 404);

    const data = subscriptionItemUpdateSchema.parse(await req.json());

    // Se non è stato passato uno status esplicito ma cambiano dati che lo
    // influenzano (scadenza/periodicità), lo ricalcoliamo sui valori risultanti.
    const affectsStatus =
      data.endDate !== undefined ||
      data.billingPeriod !== undefined ||
      data.customPeriodDays !== undefined;

    let status = data.status;
    if (status === undefined && affectsStatus) {
      status = computeItemStatus({
        status: existing.status,
        endDate: data.endDate ?? existing.endDate,
        billingPeriod: data.billingPeriod ?? existing.billingPeriod,
        customPeriodDays:
          data.customPeriodDays !== undefined
            ? data.customPeriodDays
            : existing.customPeriodDays,
        lastRenewalAt: existing.lastRenewalAt,
      });
    }

    const item = await prisma.subscriptionItem.update({
      where: { id: params.id },
      data: {
        serviceId: data.serviceId,
        startDate: data.startDate,
        endDate: data.endDate,
        priceCents: data.priceCents,
        currency: data.currency,
        billingPeriod: data.billingPeriod,
        customPeriodDays: data.customPeriodDays,
        autoChargeEnabled: data.autoChargeEnabled,
        autoChargeEndDate: data.autoChargeEndDate,
        notes: data.notes,
        ...(status !== undefined ? { status } : {}),
      },
      include: { service: true },
    });
    return json({ item });
  });
}

// DELETE /api/subscription-items/[id]  → elimina una riga (solo senza pagamenti)
export function DELETE(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const item = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { paymentItems: true } } },
    });
    if (!item) return error("Riga non trovata", 404);

    if (item._count.paymentItems > 0) {
      return error(
        "Impossibile eliminare: la riga ha pagamenti collegati. Puoi cessarla invece.",
        409,
      );
    }

    await prisma.subscriptionItem.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
