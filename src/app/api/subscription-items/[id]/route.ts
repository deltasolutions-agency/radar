import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { invalidateBeforeChange } from "@/lib/activation";
import { subscriptionItemUpdateSchema } from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import { appliedAtOnModeChange } from "@/lib/renewal-mode";

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

    // Abbonamento in attesa del primo pagamento: il link non vale più.
    const conflict = await invalidateBeforeChange(existing.subscriptionId, "servizio modificato");
    if (conflict) return error(conflict, 409);

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

    const lockAt = await appliedAtOnModeChange(
      existing,
      data.renewalIncreaseMode,
    );

    const item = await prisma.subscriptionItem.update({
      where: { id: params.id },
      data: {
        serviceId: data.serviceId,
        startDate: data.startDate,
        endDate: data.endDate,
        priceCents: data.priceCents,
        quantity: data.quantity,
        currency: data.currency,
        billingPeriod: data.billingPeriod,
        customPeriodDays: data.customPeriodDays,
        autoChargeEnabled: data.autoChargeEnabled,
        autoChargeEndDate: data.autoChargeEndDate,
        notes: data.notes,
        // undefined = invariato, null = svuotato.
        endClientName: data.endClientName,
        renewalIncreaseMode: data.renewalIncreaseMode,
        renewalIncreasePercentOverride: data.renewalIncreasePercentOverride,
        // Passaggio a ONCE su riga già aumentata → prezzo bloccato subito (Q3).
        ...(lockAt ? { renewalIncreaseAppliedAt: lockAt } : {}),
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
      select: { id: true, subscriptionId: true, _count: { select: { paymentItems: true } } },
    });
    if (!item) return error("Riga non trovata", 404);

    if (item._count.paymentItems > 0) {
      return error(
        "Impossibile eliminare: la riga ha pagamenti collegati. Puoi cessarla invece.",
        409,
      );
    }

    const conflict = await invalidateBeforeChange(item.subscriptionId, "servizio rimosso");
    if (conflict) return error(conflict, 409);

    await prisma.subscriptionItem.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
