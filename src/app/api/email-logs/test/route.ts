import { json, error, withApi, requireAdmin } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildReminderEmail } from "@/lib/email-templates";
import {
  loadReminderTemplates,
  loadShowBankTransferInstructions,
} from "@/lib/reminder-settings";
import { EXAMPLE_TOKEN } from "@/lib/example-link";

// POST /api/email-logs/test — invia all'admin collegato un reminder DI ESEMPIO
// (dati fittizi, cliente finale valorizzato) tramite sendEmail, tipo OTHER.
export function POST() {
  return withApi(async () => {
    const session = await requireAdmin();
    const recipient = session.email || process.env.ADMIN_EMAIL;
    if (!recipient) return error("Nessun destinatario configurato", 400);

    const appUrl = process.env.APP_URL ?? "";
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    endDate.setUTCHours(0, 0, 0, 0);
    const content = buildReminderEmail(
      "PROMEMORIA_7",
      {
        subscriptionId: "esempio",
        clientName: "Agenzia Esempio Srl",
        items: [
          { serviceName: "Hosting WordPress", endClientName: "Bar Sport di Mario Rossi" },
          { serviceName: "Dominio .it", endClientName: "Pizzeria Da Gino" },
        ],
        endDate,
        diffDays: 7,
      },
      {
        audience: "client",
        // Come un reminder reale senza rinnovo automatico: pulsante "Paga
        // online" (link di esempio) e riepilogo con la commissione 1,5%.
        clientRenewal: {
          itemNetCents: [12000, 1500],
          currency: "eur",
          serviceFeeEnabled: true,
          terms: [
            { serviceName: "Hosting WordPress", billingPeriod: "ANNUALE", priceLocked: false },
            { serviceName: "Dominio .it", billingPeriod: "ANNUALE", priceLocked: false },
          ],
          payUrl: `${appUrl}/pay/${EXAMPLE_TOKEN}`,
          autoChargeUrl: `${appUrl}/attiva-rinnovo/${EXAMPLE_TOKEN}`,
          showBankTransfer: await loadShowBankTransferInstructions(),
        },
        override: (await loadReminderTemplates()).PROMEMORIA_7,
      },
    );
    const res = await sendEmail(
      { ...content, subject: `[TEST] ${content.subject}` },
      recipient,
      { type: "OTHER", trigger: "MANUAL" },
    );
    if (!res.ok) {
      return error(`Invio non riuscito: ${res.error ?? "errore"}`, 502, { logId: res.logId });
    }
    return json({ ok: true, logId: res.logId, recipient });
  });
}
