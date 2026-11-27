import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { subscriptionItemCreateSchema } from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import { z } from "zod";
import {
  ActivationConflictError,
  invalidateBeforeChange,
  manualPaymentNote,
  notActiveMessage,
  recordManualNewItemPayment,
} from "@/lib/activation";

// "Già pagato" sul nuovo servizio (solo abbonamenti attivi).
const alreadyPaidSchema = z
  .object({
    method: z.string().trim().max(60).optional(),
    paidAt: z.coerce.date({ errorMap: () => ({ message: "Data pagamento non valida" }) }).optional(),
    note: z.string().trim().max(5000).optional(),
  })
  .optional();

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/items  → aggiunge una riga di servizio a un
// abbonamento esistente.
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, activationState: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);
    if (subscription.activationState === "CANCELLED_BEFORE_START") {
      return error(notActiveMessage(subscription.activationState)!, 409);
    }

    const body = await req.json();
    const data = subscriptionItemCreateSchema.parse(body);
    const alreadyPaid = alreadyPaidSchema.parse(body?.alreadyPaid ?? undefined);
    if (alreadyPaid && subscription.activationState !== "ACTIVE") {
      return error("L'abbonamento è in attesa del primo pagamento: il nuovo servizio rientra in quello.", 409);
    }

    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { id: true },
    });
    if (!service)
      return error("Servizio non trovato", 400, {
        serviceId: "Servizio inesistente",
      });

    const conflict = await invalidateBeforeChange(subscription.id, "servizio aggiunto");
    if (conflict) return error(conflict, 409);

    const customPeriodDays = data.customPeriodDays ?? null;
    const status = computeItemStatus({
      status: "ATTIVO",
      endDate: data.endDate,
      billingPeriod: data.billingPeriod,
      customPeriodDays,
      lastRenewalAt: null,
    });

    const item = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: subscription.id,
        serviceId: data.serviceId,
        startDate: data.startDate,
        endDate: data.endDate,
        priceCents: data.priceCents,
        quantity: data.quantity ?? 1,
        currency: data.currency,
        billingPeriod: data.billingPeriod,
        customPeriodDays,
        autoChargeEnabled: data.autoChargeEnabled ?? false,
        autoChargeEndDate: data.autoChargeEndDate ?? null,
        notes: data.notes,
        endClientName: data.endClientName ?? null,
        renewalIncreaseMode: data.renewalIncreaseMode,
        renewalIncreasePercentOverride: data.renewalIncreasePercentOverride ?? null,
        status,
      },
      include: { service: true },
    });

    // Già pagato: pagamento manuale della sola riga, con ricevuta.
    if (alreadyPaid) {
      try {
        await recordManualNewItemPayment(subscription.id, item.id, {
          paidAt: alreadyPaid.paidAt,
          note: manualPaymentNote(alreadyPaid.method, alreadyPaid.note),
          recordedById: session.sub,
        });
      } catch (e) {
        console.error(`[items] pagamento del nuovo servizio non registrato (item ${item.id}):`, e);
        return json(
          {
            item,
            paymentError:
              e instanceof ActivationConflictError ? e.message : "Servizio aggiunto, ma il pagamento non è stato registrato",
          },
          201,
        );
      }
    }

    return json({ item }, 201);
  });
}
