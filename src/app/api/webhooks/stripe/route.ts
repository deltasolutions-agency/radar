import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { confirmPaymentAndRenew } from "@/lib/confirm-payment";

// Il webhook deve leggere il RAW body per la verifica firma: nessun parsing
// JSON prima di constructEvent. Forziamo il runtime Node (Stripe SDK non è
// edge-safe) e disabilitiamo la cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/stripe
export async function POST(request: NextRequest) {
  // 1. RAW body PRIMA di qualsiasi altra operazione.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET non configurata");
    return NextResponse.json({ error: "Webhook non configurato" }, { status: 500 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Firma mancante" }, { status: 400 });
  }

  // 2. Verifica firma. Firma non valida → 400 (Stripe non ritenta).
  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] firma non valida:", err);
    return NextResponse.json({ error: "Firma non valida" }, { status: 400 });
  }

  // 3. Gestione eventi. Un errore di elaborazione restituisce 500 così Stripe
  // ritenta: confirmPaymentAndRenew è idempotente, quindi i retry sono sicuri.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Sessione di registrazione carta (rinnovo automatico): nessun Payment
        // da confermare, salva solo il metodo di pagamento di default.
        if (session.mode === "setup") {
          const setupIntentId =
            typeof session.setup_intent === "string"
              ? session.setup_intent
              : (session.setup_intent?.id ?? null);
          const clientId = session.metadata?.clientId ?? null;
          const requestId = session.metadata?.requestId ?? null;
          if (setupIntentId && clientId) {
            const stripe = getStripe();
            const setupIntent =
              await stripe.setupIntents.retrieve(setupIntentId);
            const pmId =
              typeof setupIntent.payment_method === "string"
                ? setupIntent.payment_method
                : (setupIntent.payment_method?.id ?? null);
            if (pmId) {
              await prisma.client.update({
                where: { id: clientId },
                data: { stripeDefaultPaymentMethodId: pmId },
              });

              // Attivazione SELETTIVA: attiva il rinnovo automatico SOLO sugli
              // item della richiesta (AutoChargeRequest.itemIds), non su tutti i
              // servizi del cliente. Marca la richiesta come utilizzata.
              if (requestId) {
                const request = await prisma.autoChargeRequest.findUnique({
                  where: { id: requestId },
                  select: { itemIds: true, usedAt: true, clientId: true },
                });
                if (request && request.clientId === clientId) {
                  await prisma.subscriptionItem.updateMany({
                    where: {
                      id: { in: request.itemIds },
                      subscription: { clientId },
                      status: { notIn: ["CESSATO", "SOSPESO"] },
                    },
                    data: { autoChargeEnabled: true, autoChargeFailCount: 0 },
                  });
                  if (!request.usedAt) {
                    await prisma.autoChargeRequest.update({
                      where: { id: requestId },
                      data: { usedAt: new Date() },
                    });
                  }
                }
              }
            }
          }
          break;
        }

        const payment = await prisma.payment.findUnique({
          where: { stripeCheckoutSessionId: session.id },
          select: { id: true },
        });
        if (!payment) {
          console.warn(
            `[stripe-webhook] nessun Payment per session ${session.id}`,
          );
          break; // 200: evento non pertinente a noi
        }

        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
        if (paymentIntentId) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { stripePaymentIntentId: paymentIntentId },
          });
        }

        const result = await confirmPaymentAndRenew(payment.id);
        const skipped = result.items.filter((i) => i.renewalSkipped);
        if (skipped.length > 0) {
          console.warn(
            `[stripe-webhook] rinnovo saltato per Payment ${payment.id}: ` +
              skipped
                .map((i) => `${i.serviceName} — ${i.renewalReason ?? ""}`)
                .join("; "),
          );
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const payment = await prisma.payment.findUnique({
          where: { stripeCheckoutSessionId: session.id },
          select: { id: true, status: true },
        });
        // Solo se ancora in attesa: non tocchiamo pagamenti già confermati.
        if (payment && payment.status === "IN_ATTESA") {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "FALLITO" },
          });
        }
        break;
      }

      default:
        // Evento non gestito: ack silenzioso.
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] errore elaborazione evento:", err);
    return NextResponse.json(
      { error: "Errore elaborazione" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
