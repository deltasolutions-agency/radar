import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// POST /api/integrations/console/items/status { ids } → stato e scadenza delle righe (letto dalla console ogni 5 minuti)
export function POST(req: NextRequest) {
  return withConsole(req, async (body) => {
    const { ids } = z.object({ ids: z.array(z.string().min(1)).max(1000) }).parse(body);
    const items = await prisma.subscriptionItem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, status: true, endDate: true, priceCents: true, billingPeriod: true, lastRenewalAt: true,
        service: { select: { id: true, name: true } },
        subscription: { select: { id: true, activationState: true, clientId: true } },
      },
    });
    return ok({ items, now: new Date().toISOString() });
  });
}
