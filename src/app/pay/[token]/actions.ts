"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { clientIp } from "@/lib/request-ip";
import { langOf, localeOf } from "@/lib/i18n";
import {
  canRegenerateCheckout,
  createAutoChargeCheckoutSession,
  regenerateCheckoutSession,
} from "@/lib/payment-checkout";

/**
 * Registra (se necessario) il consenso e reindirizza alla Checkout Session
 * Stripe reale, recuperandone l'URL fresco. Invocata dal form della pagina
 * pubblica /pay/[token].
 */
export async function proceedToPayment(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const consentGiven = formData.get("consent") === "on";
  const activateAutoCharge = formData.get("activateAutoCharge") === "on";

  const payment = await prisma.payment.findUnique({
    where: { payToken: token },
    include: {
      subscription: { include: { client: true } },
      items: {
        select: { subscriptionItem: { select: { autoChargeEnabled: true } } },
      },
    },
  });

  // Link scaduto: rigenerabile (stesso Payment, stessi importi) oppure no.
  const expired =
    !!payment?.checkoutExpiresAt &&
    payment.checkoutExpiresAt.getTime() < Date.now();
  const regenerable =
    !!payment && expired && (await canRegenerateCheckout(payment.id));

  // Pagamento inesistente, non più in attesa o scaduto non rigenerabile →
  // torna alla pagina (mostra lo stato).
  if (!payment || (payment.status !== "IN_ATTESA" && !regenerable)) {
    redirect(`/pay/${token}`);
  }
  if (expired && !regenerable) {
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
        // Lingua in cui il testo legale è stato mostrato (lingua del cliente).
        locale: localeOf(langOf(client.locale)),
      },
    });
  }

  // Attivazione rinnovo automatico (opt-in): crea una NUOVA sessione con
  // setup_future_usage + metadata, e reindirizza a quella. Onorata solo se
  // NESSUNA riga ha già l'auto-charge attivo (coerente col checkbox mostrato).
  const canActivateAutoCharge = payment.items.every(
    (pi) => !pi.subscriptionItem.autoChargeEnabled,
  );
  if (activateAutoCharge && canActivateAutoCharge) {
    const appUrl = process.env.APP_URL;
    let url: string | null = null;
    try {
      if (appUrl) {
        const res = await createAutoChargeCheckoutSession(payment.id, appUrl);
        url = res.url;
        // Link scaduto rigenerato con una nuova sessione: torna in attesa.
        if (regenerable) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "IN_ATTESA" },
          });
        }
      }
    } catch (e) {
      console.error(
        `[pay] creazione sessione con rinnovo automatico fallita (payment ${payment.id}):`,
        e,
      );
    }
    if (!url) {
      redirect(`/pay/${token}?error=stripe`);
    }
    redirect(url);
  }

  // Link scaduto: nuova Checkout Session per lo stesso Payment.
  if (regenerable) {
    let regenUrl: string | null = null;
    try {
      const appUrl = process.env.APP_URL;
      if (appUrl) regenUrl = (await regenerateCheckoutSession(payment.id, appUrl)).url;
    } catch (e) {
      console.error(`[pay] rigenerazione sessione fallita (payment ${payment.id}):`, e);
    }
    if (!regenUrl) {
      redirect(`/pay/${token}?error=stripe`);
    }
    redirect(regenUrl);
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
