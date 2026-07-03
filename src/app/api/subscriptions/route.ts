import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import {
  subscriptionCreateSchema,
  SUBSCRIPTION_STATUSES,
} from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import type { SubscriptionStatus } from "@prisma/client";

// GET /api/subscriptions?status=...
// Lista abbonamenti (contenitori) con cliente e righe di servizio. Il filtro
// status seleziona gli abbonamenti che hanno ALMENO UNA riga in quello stato.
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
      where: status ? { items: { some: { status } } } : undefined,
      include: {
        client: true,
        items: { include: { service: true }, orderBy: { endDate: "asc" } },
      },
    });

    // Ordina i contenitori per scadenza più imminente tra le loro righe.
    subscriptions.sort((a, b) => {
      const ea = a.items[0]?.endDate.getTime() ?? Number.POSITIVE_INFINITY;
      const eb = b.items[0]?.endDate.getTime() ?? Number.POSITIVE_INFINITY;
      return ea - eb;
    });

    return json({ subscriptions });
  });
}

// POST /api/subscriptions  → crea abbonamento (contenitore + almeno una riga)
export function POST(req: NextRequest) {
  return withApi(async () => {
    await requireSession();
    const data = subscriptionCreateSchema.parse(await req.json());

    // Verifica esistenza cliente.
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      select: { id: true },
    });
    if (!client)
      return error("Cliente non trovato", 400, {
        clientId: "Cliente inesistente",
      });

    // Verifica che tutti i servizi referenziati dalle righe esistano.
    const serviceIds = [...new Set(data.items.map((i) => i.serviceId))];
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    });
    if (services.length !== serviceIds.length) {
      return error("Uno o più servizi non trovati", 400, {
        items: "Servizio inesistente in una delle righe",
      });
    }

    const subscription = await prisma.subscription.create({
      data: {
        clientId: data.clientId,
        notes: data.notes,
        items: {
          create: data.items.map((it) => {
            const customPeriodDays = it.customPeriodDays ?? null;
            // Stato iniziale calcolato dalla scadenza (base ATTIVO). Nuova riga:
            // mai rinnovata → lastRenewalAt null.
            const status = computeItemStatus({
              status: "ATTIVO",
              endDate: it.endDate,
              billingPeriod: it.billingPeriod,
              customPeriodDays,
              lastRenewalAt: null,
            });
            return {
              serviceId: it.serviceId,
              startDate: it.startDate,
              endDate: it.endDate,
              priceCents: it.priceCents,
              currency: it.currency,
              billingPeriod: it.billingPeriod,
              customPeriodDays,
              autoChargeEnabled: it.autoChargeEnabled ?? false,
              autoChargeEndDate: it.autoChargeEndDate ?? null,
              notes: it.notes,
              status,
            };
          }),
        },
      },
      include: {
        client: true,
        items: { include: { service: true }, orderBy: { endDate: "asc" } },
      },
    });

    return json({ subscription }, 201);
  });
}
