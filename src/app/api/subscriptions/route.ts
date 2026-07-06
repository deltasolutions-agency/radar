import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import {
  subscriptionCreateSchema,
  SUBSCRIPTION_STATUSES,
  formatBillingPeriod,
  type BillingPeriodValue,
} from "@/lib/validations";
import { computeItemStatus } from "@/lib/subscription-status";
import { sendEmail } from "@/lib/send-email";
import {
  buildWelcomeEmail,
  buildAutoChargeRequestEmail,
} from "@/lib/email-templates";
import { formatEur } from "@/lib/format";
import { ensureDataEditToken, billingDataFor } from "@/lib/client-data";
import { buildWelcomeLetterPdf } from "@/lib/welcome-letter-pdf";
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
    await requireSession();
    const data = subscriptionCreateSchema.parse(await req.json());

    // Verifica esistenza cliente.
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      select: {
        id: true,
        name: true,
        email: true,
        welcomeEmailSentAt: true,
        dataEditToken: true,
        // Dati di fatturazione per la sezione della mail di benvenuto.
        ragioneSociale: true,
        partitaIva: true,
        codiceFiscale: true,
        indirizzo: true,
        citta: true,
        cap: true,
        provincia: true,
        sdi: true,
        pec: true,
      },
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

    const subscription = await prisma.subscription.create({
      data: {
        clientId: data.clientId,
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
    // ancora null) e se ha un'email. Non bloccante: un fallimento non deve far
    // fallire la creazione dell'abbonamento. Il timestamp viene impostato solo a
    // invio riuscito, così un errore transitorio verrà ritentato al prossimo giro.
    // Se richiesto, integra la sezione rinnovo automatico (nessuna mail separata).
    if (!client.welcomeEmailSentAt && client.email) {
      try {
        // Genera il token dati (se non esiste) e prepara la sezione fatturazione.
        let dataEditUrl: string | null = null;
        const appUrl = process.env.APP_URL;
        if (appUrl) {
          const token = await ensureDataEditToken(client);
          dataEditUrl = `${appUrl}/i-tuoi-dati/${token}`;
        }
        const content = buildWelcomeEmail({
          clientName,
          items: subscription.items.map((it) => ({
            serviceName: it.service.name,
            priceCents: it.priceCents,
            quantity: it.quantity,
            currency: it.currency,
            billingPeriod: it.billingPeriod,
            customPeriodDays: it.customPeriodDays,
            endDate: it.endDate,
          })),
          autoChargeUrl,
          dataEditUrl,
          billingData: billingDataFor(client),
        });

        // Lettera di benvenuto PDF come allegato. La generazione non deve MAI
        // bloccare l'invio: in caso di errore la mail parte senza allegato.
        // Il saluto della lettera usa SEMPRE il nome del referente (client.name),
        // non la ragione sociale, a prescindere dal saluto usato dalla mail.
        let attachments: { filename: string; content: Buffer }[] | undefined;
        try {
          const pdf = await buildWelcomeLetterPdf(client.name);
          attachments = [
            { filename: "Lettera_DeltaSolutions_Radar.pdf", content: pdf },
          ];
        } catch (e) {
          console.error(
            `[subscriptions] generazione lettera PDF fallita (client ${client.id}):`,
            e,
          );
        }

        const sent = await sendEmail(content, client.email, attachments);
        if (sent.status === "INVIATA") {
          await prisma.client.update({
            where: { id: client.id },
            data: { welcomeEmailSentAt: new Date() },
          });
        }
      } catch (e) {
        console.error(
          `[subscriptions] invio mail di benvenuto fallito (client ${client.id}):`,
          e,
        );
      }
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
            amountLabel: formatEur(it.priceCents * it.quantity, it.currency),
            periodicityLabel: formatBillingPeriod(
              it.billingPeriod as BillingPeriodValue,
              it.customPeriodDays,
            ),
          })),
          activationUrl: autoChargeUrl,
        });
        await sendEmail(content, client.email);
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
