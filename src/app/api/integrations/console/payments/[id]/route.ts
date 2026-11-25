import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { fail, ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// GET /api/integrations/console/payments/{id} → pagamento, ricevuta e carta usata
// (per la mail di benvenuto della console, che genera la ricevuta in PDF).
export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return withConsole(req, async () => {
    const p = await prisma.payment.findUnique({
      where: { id: params.id },
      include: { receipt: { include: { lines: true } }, subscription: { select: { consoleManaged: true } } },
    });
    if (!p || !p.subscription.consoleManaged) return fail("Pagamento non trovato", 404);
    let card: { brand: string; last4: string } | null = null;
    if (p.stripePaymentIntentId) {
      try {
        const pi = await getStripe().paymentIntents.retrieve(p.stripePaymentIntentId, { expand: ["payment_method"] });
        const pm = pi.payment_method;
        if (pm && typeof pm !== "string" && pm.card) card = { brand: pm.card.brand, last4: pm.card.last4 };
      } catch (e) {
        console.error("[integrations/console] carta non letta:", e);
      }
    }
    const r = p.receipt;
    return ok({
      payment: {
        id: p.id, kind: p.kind, status: p.status, method: p.method, amountCents: p.amountCents,
        currency: p.currency, paidAt: p.paidAt, subscriptionId: p.subscriptionId,
      },
      receipt: r
        ? {
            number: r.number, issuedAt: r.issuedAt, paidAt: r.paidAt, method: r.method, currency: r.currency,
            clientName: r.clientName, ragioneSociale: r.ragioneSociale, partitaIva: r.partitaIva,
            codiceFiscale: r.codiceFiscale, clientEmail: r.clientEmail, clientAddress: r.clientAddress,
            amountCents: r.amountCents, taxableAmountCents: r.taxableAmountCents, vatAmountCents: r.vatAmountCents,
            serviceFeeCents: r.serviceFeeCents,
            url: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/r/${r.token}` : null,
            lines: r.lines.map((l) => ({
              serviceName: l.serviceName, endClientName: l.endClientName, quantity: l.quantity,
              amountCents: l.amountCents, periodStart: l.periodStart, periodEnd: l.periodEnd,
            })),
          }
        : null,
      card,
    });
  });
}
