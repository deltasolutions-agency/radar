import { json, error, withApi, requireAdmin } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildReminderEmail } from "@/lib/email-templates";

// POST /api/email-logs/test — invia all'admin collegato un reminder DI ESEMPIO
// (dati fittizi, cliente finale valorizzato) tramite sendEmail, tipo OTHER.
export function POST() {
  return withApi(async () => {
    const session = await requireAdmin();
    const recipient = session.email || process.env.ADMIN_EMAIL;
    if (!recipient) return error("Nessun destinatario configurato", 400);

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
        clientRenewal: { itemNetCents: [12000, 1500], currency: "eur" },
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
