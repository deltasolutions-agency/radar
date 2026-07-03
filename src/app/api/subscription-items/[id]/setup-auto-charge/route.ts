import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeRequestEmail } from "@/lib/email-templates";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";

type Params = { params: { id: string } };

// POST /api/subscription-items/[id]/setup-auto-charge
// Genera (se serve) un token di attivazione sulla RIGA e invia al cliente il
// link alla pagina self-service /attiva-rinnovo/{token} (con gate di consenso).
// Ritorna anche l'URL, così l'admin può eventualmente dettarlo al telefono.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const item = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
      include: {
        service: true,
        subscription: { include: { client: true } },
      },
    });
    if (!item) return error("Riga non trovata", 404);

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    const client = item.subscription.client;
    if (!client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile inviare la richiesta.",
        400,
      );
    }

    // Riusa il token esistente o ne genera uno nuovo.
    let token = item.autoChargeSetupToken;
    if (!token) {
      token = randomUUID();
      await prisma.subscriptionItem.update({
        where: { id: item.id },
        data: { autoChargeSetupToken: token },
      });
    }

    const activationUrl = `${appUrl}/attiva-rinnovo/${token}`;
    const content = buildAutoChargeRequestEmail({
      serviceName: item.service.name,
      amountLabel: formatEur(item.priceCents, item.currency),
      periodicityLabel: formatBillingPeriod(
        item.billingPeriod as BillingPeriodValue,
        item.customPeriodDays,
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
