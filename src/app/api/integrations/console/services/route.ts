import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// GET /api/integrations/console/services → listino, per abbinare piani e moduli della console
export function GET(req: NextRequest) {
  return withConsole(req, async () => {
    const services = await prisma.service.findMany({
      where: { active: true },
      select: { id: true, name: true, type: true, priceCents: true, currency: true, billingPeriod: true, customPeriodDays: true },
      orderBy: { name: "asc" },
    });
    return ok({ services });
  });
}
