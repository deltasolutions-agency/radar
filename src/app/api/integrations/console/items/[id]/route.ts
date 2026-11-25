import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// PATCH /api/integrations/console/items/:id → cambio piano o fine sconto (servizio, prezzo e % di aumento dal prossimo rinnovo)
export function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return withConsole(req, async (body) => {
    const data = z.object({ serviceId: z.string().min(1).optional(), quantity: z.number().int().min(1).max(1000).optional(), priceCents: z.number().int().min(0).optional(), renewalIncreasePercentOverride: z.number().int().min(0).max(100).nullable().optional(), notes: z.string().max(5000).optional(), cease: z.boolean().optional() }).parse(body);
    const item = await prisma.subscriptionItem.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!item) return fail("Riga non trovata", 404);
    if (item.status === "CESSATO") return data.cease ? ok({ item }) : fail("La riga è cessata", 409);
    if (data.serviceId && !(await prisma.service.findUnique({ where: { id: data.serviceId }, select: { id: true } }))) return fail("Servizio non trovato", 404);
    const updated = await prisma.subscriptionItem.update({
      where: { id: item.id },
      data: { ...(data.serviceId ? { serviceId: data.serviceId } : {}), ...(data.quantity ? { quantity: data.quantity } : {}), ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}), ...(data.renewalIncreasePercentOverride !== undefined ? { renewalIncreasePercentOverride: data.renewalIncreasePercentOverride } : {}), ...(data.notes ? { notes: data.notes } : {}), ...(data.cease ? { status: "CESSATO" as const } : {}) },
      select: { id: true, serviceId: true, priceCents: true, quantity: true, status: true, endDate: true },
    });
    return ok({ item: updated });
  });
}
