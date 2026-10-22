import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionItemCreateSchema } from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import { invalidateBeforeChange, notActiveMessage } from "@/lib/activation";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/items  → aggiunge una riga di servizio a un
// abbonamento esistente.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, activationState: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    if (subscription.activationState === "CANCELLED_BEFORE_START") {
      return error(notActiveMessage(subscription.activationState)!, 409);
    }

    const data = subscriptionItemCreateSchema.parse(await req.json());

    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { id: true },
    });
    if (!service)
      return error("Servizio non trovato", 400, {
        serviceId: "Servizio inesistente",
      });

    const conflict = await invalidateBeforeChange(subscription.id, "servizio aggiunto");
    if (conflict) return error(conflict, 409);

    const customPeriodDays = data.customPeriodDays ?? null;
    const status = computeItemStatus({
      status: "ATTIVO",
      endDate: data.endDate,
      billingPeriod: data.billingPeriod,
      customPeriodDays,
      lastRenewalAt: null,
    });

    const item = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: subscription.id,
        serviceId: data.serviceId,
        startDate: data.startDate,
        endDate: data.endDate,
        priceCents: data.priceCents,
        quantity: data.quantity ?? 1,
        currency: data.currency,
        billingPeriod: data.billingPeriod,
        customPeriodDays,
        autoChargeEnabled: data.autoChargeEnabled ?? false,
        autoChargeEndDate: data.autoChargeEndDate ?? null,
        notes: data.notes,
        endClientName: data.endClientName ?? null,
        renewalIncreaseMode: data.renewalIncreaseMode,
        renewalIncreasePercentOverride: data.renewalIncreasePercentOverride ?? null,
        status,
      },
      include: { service: true },
    });

    return json({ item }, 201);
  });
}
