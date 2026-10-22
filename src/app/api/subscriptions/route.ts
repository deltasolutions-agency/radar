import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { json, error, withApi, requireSession } from "@/lib/api";
import {
  subscriptionCreateSchema,
  SUBSCRIPTION_STATUSES,
  formatBillingPeriod,
  type BillingPeriodValue,
} from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import { sendEmail } from "@/lib/send-email";
import { buildAutoChargeRequestEmail } from "@/lib/email-templates";
import { formatEur } from "@/lib/format";
import { sendWelcomeEmail, WELCOME_CLIENT_SELECT } from "@/lib/welcome-email";
import {
  ActivationConflictError,
  manualPaymentNote,
  recordManualActivation,
  sendFirstPaymentLink,
} from "@/lib/activation";
import type { SubscriptionStatus } from "@prisma/client";

// GET /api/subscriptions?status=...
// Lista abbonamenti (contenitori) con cliente e righe di servizio. Il filtro
// status seleziona gli abbonamenti che hanno ALMENO UNA riga in quello stato.
export function GET(req: NextRequest) {
  return withApi(async () => {
    await requireSession();

    const statusParam = req.nextUrl.searchParams.get("status")?.trim();
    const status =
      statusParam &&
      (SUBSCRIPTION_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as SubscriptionStatus)
        : undefined;

    const subscriptions = await prisma.subscription.findMany({
      where: status ? { items: { some: { status } } } : undefined,
      include: {
        client: true,
        items: { include: { service: true }, orderBy: { endDate: "asc" } },
      },
    });

    // Ordina i contenitori per scadenza più imminente tra le loro righe.
    subscriptions.sort((a, b) => {
      const ea = a.items[0]?.endDate.getTime() ?? Number.POSITIVE_INFINITY;
      const eb = b.items[0]?.endDate.getTime() ?? Number.POSITIVE_INFINITY;
      return ea - eb;
    });

    return json({ subscriptions });
  });
}

// POST /api/subscriptions  → crea abbonamento (contenitore + almeno una riga)
export function POST(req: NextRequest) {
  return withApi(async () => {
    const session = await requireSession();
    const data = subscriptionCreateSchema.parse(await req.json());
    // Pagamento unico (link o manuale) → una sola valuta.
    if (new Set(data.items.map((it) => it.currency ?? "eur")).size > 1) {
      return error("I servizi hanno valute diverse: non è possibile un unico primo pagamento.", 400);
    }

    // Verifica esistenza cliente.
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      // Dati di fatturazione per la sezione della mail di benvenuto.
      select: WELCOME_CLIENT_SELECT,
    });
    if (!client)
      return error("Cliente non trovato", 400, {
        clientId: "Cliente inesistente",
      });

    // Verifica che tutti i servizi referenziati dalle righe esistano.
    const serviceIds = [...new Set(data.items.map((i) => i.serviceId))];
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    });
    if (services.length !== serviceIds.length) {
      return error("Uno o più servizi non trovati", 400, {
        items: "Servizio inesistente in una delle righe",
      });
    }

    // Ogni nuovo abbonamento nasce in attesa del primo pagamento: con "già
    // pagato" lo attiva subito il pagamento manuale di attivazione qui sotto.
    const subscription = await prisma.subscription.create({
      data: {
        clientId: data.clientId,
        activationState: "PENDING_FIRST_PAYMENT",
        notes: data.notes,
        serviceFeeEnabled: data.serviceFeeEnabled ?? false,
        items: {
          create: data.items.map((it) => {
            const customPeriodDays = it.customPeriodDays ?? null;
            // Stato iniziale calcolato dalla scadenza (base ATTIVO). Nuova riga:
            // mai rinnovata → lastRenewalAt null.
            const status = computeItemStatus({
              status: "ATTIVO",
              endDate: it.endDate,
              billingPeriod: it.billingPeriod,
              customPeriodDays,
              lastRenewalAt: null,
            });
            return {
              serviceId: it.serviceId,
              startDate: it.startDate,
              endDate: it.endDate,
              priceCents: it.priceCents,
              quantity: it.quantity ?? 1,
              currency: it.currency,
              billingPeriod: it.billingPeriod,
              customPeriodDays,
              autoChargeEnabled: it.autoChargeEnabled ?? false,
              autoChargeEndDate: it.autoChargeEndDate ?? null,
              notes: it.notes,
              endClientName: it.endClientName ?? null,
              renewalIncreaseMode: it.renewalIncreaseMode,
              renewalIncreasePercentOverride: it.renewalIncreasePercentOverride ?? null,
              status,
            };
          }),
        },
      },
      include: {
        client: true,
        items: { include: { service: true }, orderBy: { endDate: "asc" } },
      },
    });

    const clientName = client.ragioneSociale?.trim()
      ? client.ragioneSociale
      : client.name;

    // ── "Da pagare": in attesa del primo pagamento ────────────────────────
    // Link di primo pagamento (Stripe, prezzi iniziali) nel benvenuto (primo
    // abbonamento del cliente) o nell'email "Attivazione nuovi servizi". Il
    // rinnovo automatico si attiva dalla casella su /pay, non da una richiesta
    // separata. Non bloccante: l'admin può reinviare il link dal dettaglio.
    if (data.paymentMode === "DA_PAGARE") {
      const firstPayment = await sendFirstPaymentLink(subscription.id, { trigger: "MANUAL" });
      return json({ subscription, firstPayment }, 201);
    }

    // ── "Già pagato": attivazione con pagamento manuale + ricevuta ────────
    try {
      await recordManualActivation(subscription.id, {
        paidAt: data.manualPayment?.paidAt,
        note: manualPaymentNote(data.manualPayment?.method, data.manualPayment?.note),
        recordedById: session.sub,
      });
    } catch (e) {
      // L'abbonamento resta in attesa: l'admin può usare "Segna come pagato".
      console.error(`[subscriptions] attivazione manuale fallita (sub ${subscription.id}):`, e);
      return json(
        {
          subscription,
          activationError:
            e instanceof ActivationConflictError ? e.message : "Registrazione del pagamento non riuscita",
        },
        201,
      );
    }

    // L.3 — Richiesta di attivazione rinnovo automatico (se richiesto in creazione):
    // crea una AutoChargeRequest per TUTTI gli item appena creati e prepara il link.
    // La richiesta viene comunque creata anche se l'email non parte (l'admin può
    // reinviarla dal dettaglio). Non bloccante.
    let autoChargeUrl: string | null = null;
    if (data.requestAutoCharge) {
      try {
        const appUrl = process.env.APP_URL;
        const request = await prisma.autoChargeRequest.create({
          data: {
            clientId: client.id,
            itemIds: subscription.items.map((it) => it.id),
          },
        });
        if (appUrl) autoChargeUrl = `${appUrl}/attiva-rinnovo/${request.token}`;
      } catch (e) {
        console.error(
          `[subscriptions] creazione AutoChargeRequest fallita (client ${client.id}):`,
          e,
        );
      }
    }

    // Mail di benvenuto: solo al PRIMO abbonamento del cliente (welcomeEmailSentAt
    // ancora null) e se ha un'email. Non bloccante. Se richiesto, integra la
    // sezione rinnovo automatico (nessuna mail separata).
    if (!client.welcomeEmailSentAt && client.email) {
      await sendWelcomeEmail({
        client,
        subscriptionId: subscription.id,
        items: subscription.items,
        autoChargeUrl,
      });
    } else if (autoChargeUrl && client.email) {
      // Cliente già "onboardato" (benvenuto già inviato) ma è stato richiesto il
      // rinnovo automatico: invia la richiesta di attivazione come mail dedicata.
      try {
        const content = buildAutoChargeRequestEmail({
          items: subscription.items.map((it) => ({
            serviceName:
              it.quantity > 1
                ? `${it.service.name} ×${it.quantity}`
                : it.service.name,
            endClientName: it.endClientName,
            // Importo del prossimo rinnovo (aumento incluso se dovuto).
            amountLabel: formatEur(
              renewalChargePriceCents(it) * it.quantity,
              it.currency,
            ),
            periodicityLabel: formatBillingPeriod(
              it.billingPeriod as BillingPeriodValue,
              it.customPeriodDays,
            ),
          })),
          activationUrl: autoChargeUrl,
        });
        await sendEmail(content, client.email, {
          type: "AUTOCHARGE_REQUEST",
          trigger: "MANUAL",
          clientId: client.id,
          subscriptionId: subscription.id,
          itemIds: subscription.items.map((it) => it.id),
        });
      } catch (e) {
        console.error(
          `[subscriptions] invio richiesta rinnovo automatico fallito (client ${client.id}):`,
          e,
        );
      }
    }

    return json({ subscription }, 201);
  });
}
