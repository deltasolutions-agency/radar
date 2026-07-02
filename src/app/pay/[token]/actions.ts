"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { clientIp } from "@/lib/request-ip";

/**
 * Registra (se necessario) il consenso e reindirizza alla Checkout Session
 * Stripe reale, recuperandone l'URL fresco. Invocata dal form della pagina
 * pubblica /pay/[token].
 */
export async function proceedToPayment(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const consentGiven = formData.get("consent") === "on";

  const payment = await prisma.payment.findUnique({
    where: { payToken: token },
    include: { subscription: { include: { client: true } } },
  });

  // Pagamento inesistente o non più in attesa → torna alla pagina (mostra stato).
  if (!payment || payment.status !== "IN_ATTESA") {
    redirect(`/pay/${token}`);
  }

  // Link scaduto localmente.
  if (
    payment.checkoutExpiresAt &&
    payment.checkoutExpiresAt.getTime() < Date.now()
  ) {
    redirect(`/pay/${token}`);
  }

  const client = payment.subscription.client;
  const existingConsent = await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  });

  if (!existingConsent) {
    if (!consentGiven) {
      redirect(`/pay/${token}?error=consent`);
    }
    await prisma.consentLog.create({
      data: {
        clientId: client.id,
        version: CURRENT_CONSENT_VERSION,
        ipAddress: clientIp(),
      },
    });
  }

  if (!payment.stripeCheckoutSessionId) {
    redirect(`/pay/${token}?error=stripe`);
  }

  // Recupera l'URL Stripe fresco (valido finché la sessione non è scaduta).
  let url: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(
      payment.stripeCheckoutSessionId,
    );
    url = session.url;
  } catch {
    // gestito sotto (url resta null)
  }

  if (!url) {
    redirect(`/pay/${token}?error=stripe`);
  }

  redirect(url);
}
