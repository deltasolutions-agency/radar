import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { periodDurationDays, MS_PER_DAY } from "@/lib/billing-period";
import { recordManualActivation, sendFirstPaymentLink } from "@/lib/activation";
import { fail, ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().min(1),
  notes: z.string().max(5000).optional(),
  // DA_PAGARE: Radar invia il link del primo pagamento (come dalla dashboard).
  // PAGATO: attivo subito con pagamento manuale registrato (es. clienti di prova).
  paymentMode: z.enum(["DA_PAGARE", "PAGATO"]),
  items: z.array(z.object({
    serviceId: z.string().min(1),
    priceCents: z.number().int().min(0).optional(),
    quantity: z.number().int().min(1).max(1000).optional(),
    endClientName: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })).min(1),
});

// POST /api/integrations/console/subscriptions → abbonamento con le righe del cloud (piano, moduli)
export function POST(req: NextRequest) {
  return withConsole(req, async (body) => {
    const data = schema.parse(body);
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
    if (!client) return fail("Cliente non trovato", 404);
    const services = await prisma.service.findMany({ where: { id: { in: data.items.map((i) => i.serviceId) } } });
    const byId = new Map(services.map((s) => [s.id, s]));
    if (data.items.some((i) => !byId.has(i.serviceId))) return fail("Servizio non trovato", 404);

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const subscription = await prisma.subscription.create({
      data: {
        clientId: client.id,
        activationState: "PENDING_FIRST_PAYMENT",
        notes: data.notes ?? "Creato dalla console Delta Cloud",
        items: {
          create: data.items.map((it) => {
            const s = byId.get(it.serviceId)!;
            const days = periodDurationDays({ billingPeriod: s.billingPeriod, customPeriodDays: s.customPeriodDays }) ?? 30;
            const endDate = new Date(start.getTime() + (days - 1) * MS_PER_DAY);
            const status = computeItemStatus({ status: "ATTIVO", endDate, billingPeriod: s.billingPeriod, customPeriodDays: s.customPeriodDays, lastRenewalAt: null });
            return {
              serviceId: s.id, startDate: start, endDate, status,
              priceCents: it.priceCents ?? s.priceCents, currency: s.currency,
              billingPeriod: s.billingPeriod, customPeriodDays: s.customPeriodDays,
              quantity: it.quantity ?? 1, endClientName: it.endClientName ?? null, notes: it.notes,
            };
          }),
        },
      },
      include: { items: { select: { id: true, serviceId: true, status: true, endDate: true } } },
    });

    if (data.paymentMode === "DA_PAGARE") {
      const firstPayment = await sendFirstPaymentLink(subscription.id, { trigger: "MANUAL" });
      return ok({ subscriptionId: subscription.id, items: subscription.items, firstPayment }, 201);
    }
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!admin) return ok({ subscriptionId: subscription.id, items: subscription.items, activationError: "Nessun amministratore per registrare il pagamento" }, 201);
    try {
      await recordManualActivation(subscription.id, { paidAt: new Date(), note: "Attivazione dalla console Delta Cloud", recordedById: admin.id });
    } catch (e) {
      return ok({ subscriptionId: subscription.id, items: subscription.items, activationError: (e as Error).message }, 201);
    }
    return ok({ subscriptionId: subscription.id, items: subscription.items }, 201);
  });
}
