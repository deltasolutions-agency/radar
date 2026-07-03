"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CURRENT_CONSENT_VERSION } from "@/lib/legal";
import { clientIp } from "@/lib/request-ip";
import { createSetupCheckoutUrl } from "@/lib/setup-checkout";

/**
 * Registra (se necessario) il consenso e avvia la registrazione carta Stripe
 * (mode:'setup'). Il consenso è raccolto PRIMA della registrazione carta.
 */
export async function activateAutoCharge(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const consentGiven = formData.get("consent") === "on";

  const item = await prisma.subscriptionItem.findUnique({
    where: { autoChargeSetupToken: token },
    include: { subscription: { include: { client: true } } },
  });
  if (!item) {
    redirect(`/attiva-rinnovo/${token}`);
  }

  const client = item.subscription.client;
  const existingConsent = await prisma.consentLog.findFirst({
    where: { clientId: client.id, version: CURRENT_CONSENT_VERSION },
    select: { id: true },
  });

  if (!existingConsent) {
    if (!consentGiven) {
      redirect(`/attiva-rinnovo/${token}?error=consent`);
    }
    await prisma.consentLog.create({
      data: {
        clientId: client.id,
        version: CURRENT_CONSENT_VERSION,
        ipAddress: clientIp(),
      },
    });
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    redirect(`/attiva-rinnovo/${token}?error=config`);
  }

  let url: string | null = null;
  try {
    url = await createSetupCheckoutUrl(
      {
        id: item.subscriptionId,
        currency: item.currency,
        client: {
          id: client.id,
          email: client.email,
          name: client.name,
          stripeCustomerId: client.stripeCustomerId,
        },
      },
      appUrl,
      token,
    );
  } catch {
    // gestito sotto (url resta null)
  }

  if (!url) {
    redirect(`/attiva-rinnovo/${token}?error=stripe`);
  }

  redirect(url);
}
