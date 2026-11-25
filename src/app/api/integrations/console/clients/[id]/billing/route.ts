import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// GET /api/integrations/console/clients/:id/billing → righe attive, pagamenti e ricevute (area clienti della console)
export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return withConsole(req, async () => {
    const appUrl = process.env.APP_URL ?? "";
    const subs = await prisma.subscription.findMany({
      where: { clientId: params.id },
      select: {
        id: true, activationState: true,
        items: { select: { id: true, status: true, endDate: true, priceCents: true, quantity: true, billingPeriod: true, customPeriodDays: true, service: { select: { name: true } } } },
        payments: {
          where: { status: { in: ["CONFERMATO", "IN_ATTESA", "RIMBORSATO"] } },
          orderBy: { createdAt: "desc" },
          take: 36,
          select: {
            id: true, kind: true, amountCents: true, currency: true, status: true, paidAt: true, createdAt: true, payToken: true,
            invoiceNumber: true, invoiceDate: true,
            receipt: { select: { number: true, token: true } },
          },
        },
      },
    });
    const items = subs.flatMap((s) => s.items.map((i) => ({ ...i, serviceName: i.service.name, subscriptionId: s.id })));
    const payments = subs.flatMap((s) => s.payments).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((p) => ({
      id: p.id, kind: p.kind, amountCents: p.amountCents, currency: p.currency, status: p.status, paidAt: p.paidAt, createdAt: p.createdAt,
      invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate,
      receiptNumber: p.receipt?.number ?? null,
      receiptUrl: p.receipt && appUrl ? `${appUrl}/r/${p.receipt.token}` : null,
      payUrl: p.status === "IN_ATTESA" && appUrl ? `${appUrl}/pay/${p.payToken}` : null,
    }));
    return ok({ items, payments });
  });
}
