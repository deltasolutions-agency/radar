import "server-only";
import type { EmailTrigger, Locale, Service, SubscriptionItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/send-email";
import { buildWelcomeEmail, type FirstPaymentBlock } from "@/lib/email-templates";
import { ensureDataEditToken, billingDataFor } from "@/lib/client-data";
import { buildWelcomeLetterPdf } from "@/lib/welcome-letter-pdf";
import { langOf, localizedServiceName } from "@/lib/i18n";

/** Cliente con i campi usati dalla mail di benvenuto. */
export type WelcomeClient = {
  id: string;
  name: string;
  email: string;
  ragioneSociale: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  provincia: string | null;
  sdi: string | null;
  pec: string | null;
  dataEditToken: string | null;
  /** Lingua del cliente (IT/EN). */
  locale: Locale;
};

export const WELCOME_CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  welcomeEmailSentAt: true,
  dataEditToken: true,
  ragioneSociale: true,
  partitaIva: true,
  codiceFiscale: true,
  indirizzo: true,
  citta: true,
  cap: true,
  provincia: true,
  sdi: true,
  pec: true,
  locale: true,
} as const;

/**
 * Mail di benvenuto con lettera PDF (solo al PRIMO abbonamento del cliente: il
 * chiamante verifica welcomeEmailSentAt). Il timestamp viene impostato solo a
 * invio riuscito, così un errore transitorio verrà ritentato. Mai bloccante:
 * ritorna true se la mail è partita.
 */
export async function sendWelcomeEmail(params: {
  client: WelcomeClient;
  subscriptionId: string;
  items: (SubscriptionItem & { service: Service })[];
  autoChargeUrl: string | null;
  /** Abbonamento "da pagare": blocco "Primo pagamento" con pulsante Paga ora. */
  firstPayment?: FirstPaymentBlock | null;
  trigger?: EmailTrigger;
}): Promise<boolean> {
  const { client, items } = params;
  try {
    const clientName = client.ragioneSociale?.trim() ? client.ragioneSociale : client.name;
    const lang = langOf(client.locale);
    // Genera il token dati (se non esiste) e prepara la sezione fatturazione.
    let dataEditUrl: string | null = null;
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      const token = await ensureDataEditToken(client);
      dataEditUrl = `${appUrl}/i-tuoi-dati/${token}`;
    }
    const content = buildWelcomeEmail({
      clientName,
      items: items.map((it) => ({
        serviceName: localizedServiceName(it.service, lang),
        endClientName: it.endClientName,
        priceCents: it.priceCents,
        quantity: it.quantity,
        currency: it.currency,
        billingPeriod: it.billingPeriod,
        customPeriodDays: it.customPeriodDays,
        endDate: it.endDate,
      })),
      autoChargeUrl: params.autoChargeUrl,
      dataEditUrl,
      billingData: billingDataFor(client, lang),
      firstPayment: params.firstPayment ?? null,
      lang,
    });

    // Lettera di benvenuto PDF come allegato. La generazione non deve MAI
    // bloccare l'invio: in caso di errore la mail parte senza allegato.
    // Il saluto della lettera usa SEMPRE il nome del referente (client.name),
    // non la ragione sociale, a prescindere dal saluto usato dalla mail.
    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const pdf = await buildWelcomeLetterPdf(client.name, lang);
      attachments = [
        {
          filename:
            lang === "en" ? "Welcome_DeltaSolutions_Radar.pdf" : "Lettera_DeltaSolutions_Radar.pdf",
          content: pdf,
        },
      ];
    } catch (e) {
      console.error(`[welcome] generazione lettera PDF fallita (client ${client.id}):`, e);
    }

    const sent = await sendEmail(
      content,
      client.email,
      {
        type: "WELCOME",
        trigger: params.trigger ?? "MANUAL",
        clientId: client.id,
        subscriptionId: params.subscriptionId,
        itemIds: items.map((it) => it.id),
        dedupeKey: `welcome:${client.id}`,
      },
      attachments,
    );
    if (sent.status === "INVIATA") {
      await prisma.client.update({
        where: { id: client.id },
        data: { welcomeEmailSentAt: new Date() },
      });
      return true;
    }
  } catch (e) {
    console.error(`[welcome] invio mail di benvenuto fallito (client ${client.id}):`, e);
  }
  return false;
}
