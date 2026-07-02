import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeRequestEmail } from "@/lib/email-templates";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/setup-auto-charge
// Genera (se serve) un token di attivazione e invia al cliente il link alla
// pagina self-service /attiva-rinnovo/{token} (con gate di consenso). Ritorna
// anche l'URL, così l'admin può eventualmente dettarlo al telefono.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { client: true, service: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    const client = subscription.client;
    if (!client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile inviare la richiesta.",
        400,
      );
    }

    // Riusa il token esistente o ne genera uno nuovo.
    let token = subscription.autoChargeSetupToken;
    if (!token) {
      token = randomUUID();
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { autoChargeSetupToken: token },
      });
    }

    const activationUrl = `${appUrl}/attiva-rinnovo/${token}`;
    const content = buildAutoChargeRequestEmail({
      serviceName: subscription.service.name,
      amountLabel: formatEur(subscription.priceCents, subscription.currency),
      periodicityLabel: formatBillingPeriod(
        subscription.billingPeriod as BillingPeriodValue,
        subscription.customPeriodDays,
      ),
      activationUrl,
    });

    const sent = await sendEmail(content, client.email);

    return json({
      sent: sent.status === "INVIATA",
      recipient: client.email,
      url: activationUrl,
    });
  });
}
