import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { createCheckoutPayment } from "@/lib/payment-checkout";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/checkout?mode=direct|send
// Body: { subscriptionItemIds: string[] } — le righe da raggruppare nel pagamento.
//  - mode=direct (default): crea la sessione e ritorna { url } per il redirect
//    immediato nel browser dell'admin.
//  - mode=send: crea la sessione e INVIA il link via email al cliente.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const mode =
      req.nextUrl.searchParams.get("mode") === "send" ? "send" : "direct";

    const body = await req.json().catch(() => ({}));
    const itemIds: string[] = Array.isArray(body?.subscriptionItemIds)
      ? body.subscriptionItemIds.filter((v: unknown) => typeof v === "string")
      : [];
    if (itemIds.length === 0) {
      return error("Seleziona almeno un servizio da pagare", 400);
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        items: {
          where: { id: { in: itemIds } },
          include: { service: true },
        },
      },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    if (subscription.items.length !== itemIds.length) {
      return error(
        "Uno o più servizi selezionati non appartengono all'abbonamento",
        400,
      );
    }
    // Una Checkout Session non può mischiare valute.
    if (new Set(subscription.items.map((it) => it.currency)).size > 1) {
      return error(
        "I servizi selezionati hanno valute diverse: non è possibile un unico pagamento.",
        400,
      );
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    // In modalità "send" serve un'email cliente: controlla prima di creare la
    // sessione, per non lasciare sessioni/pagamenti orfani.
    if (mode === "send" && !subscription.client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile inviare il link.",
        400,
      );
    }

    const result = await createCheckoutPayment(
      {
        subscriptionId: subscription.id,
        clientEmail: subscription.client.email,
        items: subscription.items.map((it) => ({
          id: it.id,
          currency: it.currency,
          priceCents: it.priceCents,
          endDate: it.endDate,
          billingPeriod: it.billingPeriod,
          customPeriodDays: it.customPeriodDays,
          service: {
            name: it.service.name,
            description: it.service.description,
          },
        })),
      },
      appUrl,
      { sendToClient: mode === "send" },
    );

    if (mode === "send") {
      return json({
        sent: result.emailSent,
        recipient: result.recipient,
        expiresAt: result.expiresAt,
      });
    }

    return json({ url: result.url });
  });
}
