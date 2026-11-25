import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { fail, ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

const schema = z.object({
  serviceId: z.string().min(1),
  quantity: z.number().int().min(1).max(1000).optional(),
  priceCents: z.number().int().min(0).optional(),
  renewalIncreaseMode: z.enum(["ONCE", "EVERY_RENEWAL"]).optional(),
  renewalIncreasePercentOverride: z.number().int().min(0).max(100).optional(),
  // Riga a cui allineare la scadenza (di solito il canone): la nuova riga si paga dal prossimo rinnovo.
  alignToItemId: z.string().min(1).optional(),
  endClientName: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

// POST /api/integrations/console/subscriptions/:id/items → aggiunge una riga (utenti, spazio, moduli) a un abbonamento attivo
export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return withConsole(req, async (body) => {
    const data = schema.parse(body);
    const sub = await prisma.subscription.findUnique({ where: { id: params.id }, select: { id: true, activationState: true } });
    if (!sub) return fail("Abbonamento non trovato", 404);
    if (sub.activationState === "CANCELLED_BEFORE_START") return fail("Abbonamento annullato", 409);
    const s = await prisma.service.findUnique({ where: { id: data.serviceId } });
    if (!s) return fail("Servizio non trovato", 404);
    const ref = data.alignToItemId
      ? await prisma.subscriptionItem.findFirst({ where: { id: data.alignToItemId, subscriptionId: sub.id }, select: { endDate: true } })
      : null;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const endDate = ref?.endDate ?? new Date(start.getTime() + 29 * 86_400_000);
    const status = computeItemStatus({ status: "ATTIVO", endDate, billingPeriod: s.billingPeriod, customPeriodDays: s.customPeriodDays, lastRenewalAt: null });
    const item = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: sub.id, serviceId: s.id, startDate: start, endDate, status,
        priceCents: data.priceCents ?? s.priceCents, currency: s.currency, quantity: data.quantity ?? 1,
        billingPeriod: s.billingPeriod, customPeriodDays: s.customPeriodDays,
        renewalIncreaseMode: data.renewalIncreaseMode ?? "EVERY_RENEWAL",
        renewalIncreasePercentOverride: data.renewalIncreasePercentOverride ?? null,
        endClientName: data.endClientName ?? null, notes: data.notes ?? "Aggiunto dalla console Delta Cloud",
      },
      select: { id: true, serviceId: true, status: true, endDate: true, quantity: true },
    });
    return ok({ item }, 201);
  });
}
