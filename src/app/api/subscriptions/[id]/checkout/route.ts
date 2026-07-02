import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { createCheckoutPayment } from "@/lib/payment-checkout";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/checkout?mode=direct|send
//  - mode=direct (default): crea la sessione e ritorna { url } per il redirect
//    immediato nel browser dell'admin.
//  - mode=send: crea la sessione e INVIA il link via email al cliente, senza
//    reindirizzare l'admin. Ritorna { sent, recipient, expiresAt }.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const mode =
      req.nextUrl.searchParams.get("mode") === "send" ? "send" : "direct";

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { service: true, client: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

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

    const result = await createCheckoutPayment(subscription, appUrl, {
      sendToClient: mode === "send",
    });

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
