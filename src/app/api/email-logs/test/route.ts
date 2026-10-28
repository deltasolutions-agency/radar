import { json, error, withApi, requireAdmin } from "@/lib/api";
import { sendEmail } from "@/lib/send-email";
import { buildReminderEmail } from "@/lib/email-templates";
import { loadReminderTemplates } from "@/lib/reminder-settings";
import { EXAMPLE_TOKEN } from "@/lib/example-link";
import { langFromParam, tr } from "@/lib/i18n";

// POST /api/email-logs/test — invia all'admin collegato un reminder DI ESEMPIO
// (dati fittizi, cliente finale valorizzato) tramite sendEmail, tipo OTHER.
// Body facoltativo { lang: "it" | "en" } (default italiano): stessi testi e
// override che riceverebbe un cliente in quella lingua.
export function POST(req: Request) {
  return withApi(async () => {
    const body = (await req.json().catch(() => ({}))) as { lang?: string };
    const lang = langFromParam(body?.lang);
    const session = await requireAdmin();
    const recipient = session.email || process.env.ADMIN_EMAIL;
    if (!recipient) return error("Nessun destinatario configurato", 400);

    const appUrl = process.env.APP_URL ?? "";
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    endDate.setUTCHours(0, 0, 0, 0);
    const hosting = tr(lang, { it: "Hosting WordPress", en: "WordPress Hosting" });
    const domain = tr(lang, { it: "Dominio .it", en: ".it domain" });
    const content = buildReminderEmail(
      "PROMEMORIA_7",
      {
        subscriptionId: "esempio",
        clientName: tr(lang, { it: "Agenzia Esempio Srl", en: "Example Agency Ltd" }),
        items: [
          { serviceName: hosting, endClientName: "Bar Sport di Mario Rossi" },
          { serviceName: domain, endClientName: "Pizzeria Da Gino" },
        ],
        endDate,
        diffDays: 7,
      },
      {
        audience: "client",
        // Come un reminder reale senza rinnovo automatico: pulsante "Paga
        // online" (link di esempio) e solo l'imponibile (IVA e commissione
        // sono sulla pagina /pay).
        clientRenewal: {
          itemNetCents: [12000, 1500],
          currency: "eur",
          serviceFeeEnabled: true,
          terms: [
            { serviceName: hosting, billingPeriod: "ANNUALE", priceLocked: false },
            { serviceName: domain, billingPeriod: "ANNUALE", priceLocked: false },
          ],
          payUrl: `${appUrl}/pay/${EXAMPLE_TOKEN}`,
          autoChargeUrl: `${appUrl}/attiva-rinnovo/${EXAMPLE_TOKEN}`,
        },
        // Solo l'override della lingua scelta (come nel cron).
        override: (await loadReminderTemplates())[lang].PROMEMORIA_7,
        lang,
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
