import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionCreateSchema, SUBSCRIPTION_STATUSES } from "@/lib/validations";
import { computeSubscriptionStatus } from "@/lib/subscription-status";
import type { SubscriptionStatus } from "@prisma/client";

// GET /api/subscriptions?status=...  → lista abbonamenti (client + service inclusi)
export function GET(req: NextRequest) {
  return withApi(async () => {
    await requireSession();

    const statusParam = req.nextUrl.searchParams.get("status")?.trim();
    const status =
      statusParam &&
      (SUBSCRIPTION_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as SubscriptionStatus)
        : undefined;

    const subscriptions = await prisma.subscription.findMany({
      where: status ? { status } : undefined,
      include: { client: true, service: true },
      orderBy: { endDate: "asc" },
    });
    return json({ subscriptions });
  });
}

// POST /api/subscriptions  → crea abbonamento
export function POST(req: NextRequest) {
  return withApi(async () => {
    await requireSession();
    const data = subscriptionCreateSchema.parse(await req.json());

    // Verifica esistenza cliente e servizio referenziati.
    const [client, service] = await Promise.all([
      prisma.client.findUnique({
        where: { id: data.clientId },
        select: { id: true },
      }),
      prisma.service.findUnique({
        where: { id: data.serviceId },
        select: { id: true },
      }),
    ]);
    if (!client) return error("Cliente non trovato", 400, { clientId: "Cliente inesistente" });
    if (!service) return error("Servizio non trovato", 400, { serviceId: "Servizio inesistente" });

    // Stato iniziale calcolato dalla scadenza (base ATTIVO). Nuovo abbonamento:
    // mai rinnovato → lastRenewalAt null.
    const status = computeSubscriptionStatus({
      status: "ATTIVO",
      endDate: data.endDate,
      billingPeriod: data.billingPeriod,
      customPeriodDays: data.customPeriodDays ?? null,
      lastRenewalAt: null,
    });

    const subscription = await prisma.subscription.create({
      data: { ...data, status },
    });
    return json({ subscription }, 201);
  });
}
