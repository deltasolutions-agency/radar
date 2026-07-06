import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeRequestEmail } from "@/lib/email-templates";
import { formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { addVatToNet } from "@/lib/vat";

type Params = { params: { id: string } };

const NON_SELECTABLE = ["CESSATO", "SOSPESO"] as const;

// POST /api/subscriptions/[id]/auto-charge-request
// Body: { subscriptionItemIds: string[] } — i servizi (di questo contenitore) da
// includere nella richiesta di attivazione del rinnovo automatico.
//
// Crea una AutoChargeRequest (clientId + itemIds SELEZIONATI), genera il link
// pubblico /attiva-rinnovo/{token} e invia al cliente l'email che elenca
// ESATTAMENTE quei servizi. L'attivazione riguarderà SOLO quegli item.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const body = await req.json().catch(() => ({}));
    const itemIds: string[] = Array.isArray(body?.subscriptionItemIds)
      ? body.subscriptionItemIds.filter((v: unknown) => typeof v === "string")
      : [];
    if (itemIds.length === 0) {
      return error("Seleziona almeno un servizio da includere", 400);
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

    // Tutti gli id selezionati devono appartenere al contenitore ed essere idonei.
    if (subscription.items.length !== itemIds.length) {
      return error(
        "Uno o più servizi selezionati non appartengono all'abbonamento",
        400,
      );
    }
    const notEligible = subscription.items.filter(
      (it) =>
        (NON_SELECTABLE as readonly string[]).includes(it.status) ||
        it.autoChargeEnabled,
    );
    if (notEligible.length > 0) {
      return error(
        "Uno o più servizi selezionati non sono idonei (cessati/sospesi o già con rinnovo automatico attivo).",
        400,
      );
    }

    const client = subscription.client;
    if (!client.email) {
      return error(
        "Il cliente non ha un indirizzo email: impossibile inviare la richiesta.",
        400,
      );
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) return error("APP_URL non configurata", 500);

    // Crea la richiesta con esattamente gli item scelti.
    const request = await prisma.autoChargeRequest.create({
      data: {
        clientId: client.id,
        itemIds: subscription.items.map((it) => it.id),
      },
    });

    const activationUrl = `${appUrl}/attiva-rinnovo/${request.token}`;
    const content = buildAutoChargeRequestEmail({
      items: subscription.items.map((it) => ({
        serviceName:
          it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
        amountLabel: formatEur(
          addVatToNet(it.priceCents * it.quantity).grossCents,
          it.currency,
        ),
        periodicityLabel: formatBillingPeriod(
          it.billingPeriod as BillingPeriodValue,
          it.customPeriodDays,
        ),
      })),
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
