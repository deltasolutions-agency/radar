import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionItemCreateSchema } from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/items  → aggiunge una riga di servizio a un
// abbonamento esistente.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const data = subscriptionItemCreateSchema.parse(await req.json());

    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { id: true },
    });
    if (!service)
      return error("Servizio non trovato", 400, {
        serviceId: "Servizio inesistente",
      });

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
        currency: data.currency,
        billingPeriod: data.billingPeriod,
        customPeriodDays,
        autoChargeEnabled: data.autoChargeEnabled ?? false,
        autoChargeEndDate: data.autoChargeEndDate ?? null,
        notes: data.notes,
        status,
      },
      include: { service: true },
    });

    return json({ item }, 201);
  });
}
