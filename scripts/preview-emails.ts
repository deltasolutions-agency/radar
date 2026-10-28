// Anteprima delle email rivolte al CLIENTE, in italiano e in inglese.
//
//   npx tsx scripts/preview-emails.ts
//
// Genera in tmp/email-preview/ un file .html per ogni email (IT ed EN) con dati
// finti, più un index.html che le affianca. Nessun DB, nessun invio, nessuna
// variabile d'ambiente obbligatoria (APP_URL di fallback).
import "./script-env"; // neutralizza `import "server-only"` (e carica .env se c'è)
import fs from "node:fs";
import path from "node:path";
import * as T from "@/lib/email-templates";
import type { Lang } from "@/lib/i18n";

process.env.APP_URL ??= "https://radar.deltasolutions.agency";

type Preview = { id: string; title: string; content: T.EmailContent };

const D = (s: string) => new Date(`${s}T00:00:00Z`);

/** Nomi dei servizi già localizzati, come farebbe il chiamante. */
const SVC = {
  hosting: { it: "Hosting WordPress", en: "WordPress Hosting" },
  mail: { it: "Caselle email ×3", en: "Email mailboxes ×3" },
  domain: { it: "Dominio .it", en: ".it domain" },
} as const;

const BILLING: Record<Lang, T.BillingDatum[]> = {
  it: [
    { label: "Ragione sociale", value: "Rossi Arredamenti S.r.l." },
    { label: "Partita IVA", value: "01234567890" },
    { label: "Codice fiscale", value: "" },
    { label: "Indirizzo", value: "Via Cola di Rienzo 120" },
    { label: "Città", value: "Roma" },
    { label: "CAP", value: "00192" },
    { label: "Provincia", value: "RM" },
    { label: "Codice SDI", value: "M5UXCR1" },
    { label: "PEC", value: "rossiarredamenti@pec.it" },
  ],
  en: [
    { label: "Company name", value: "Smith Interiors Ltd" },
    { label: "VAT number", value: "GB123456789" },
    { label: "Tax code", value: "" },
    { label: "Address", value: "12 Baker Street" },
    { label: "City", value: "London" },
    { label: "Postcode", value: "NW1 6XE" },
    { label: "Province", value: "" },
    { label: "SDI code (e-invoicing)", value: "XXXXXXX" },
    { label: "PEC (certified email)", value: "" },
  ],
};

/** Tutte le email cliente nella lingua indicata. */
export function samples(lang: Lang, mod: typeof T = T): Preview[] {
  const s = (k: keyof typeof SVC) => SVC[k][lang];
  const clientName = lang === "en" ? "Smith Interiors Ltd" : "Rossi Arredamenti S.r.l.";
  const app = process.env.APP_URL!;
  const one = [{ serviceName: s("hosting"), endClientName: null }];
  const many = [
    { serviceName: s("hosting"), endClientName: "Bar Centrale" },
    { serviceName: s("mail"), endClientName: "Bar Centrale" },
  ];
  const mixedEndClient = [
    { serviceName: s("hosting"), endClientName: "Bar Centrale" },
    { serviceName: s("domain"), endClientName: "Studio Bianchi" },
  ];
  const renewal = (items: { serviceName: string }[], locked = false): T.ClientRenewalInfo => ({
    itemNetCents: items.map((_, i) => (i === 0 ? 24000 : 3600)),
    currency: "eur",
    serviceFeeEnabled: true,
    payUrl: `${app}/pay/tok_demo`,
    autoChargeUrl: `${app}/attiva-rinnovo/tok_demo`,
    terms: items.map((it, i) => ({
      serviceName: it.serviceName,
      billingPeriod: i === 0 ? "ANNUALE" : "MENSILE",
      priceLocked: locked && i === 0,
    })),
  });
  const rem = (
    type: T.ReminderConfigurableType,
    items: T.ReminderEmailItem[],
    diffDays: number,
    info?: T.ClientRenewalInfo,
  ) =>
    mod.buildReminderEmail(
      type,
      { subscriptionId: "sub_demo", clientName, items, endDate: D("2026-11-30"), diffDays },
      { audience: "client", clientRenewal: info, lang },
    );

  const fpItems: T.FirstPaymentEmailItem[] = [
    { serviceName: s("hosting"), endClientName: null, netCents: 24000, startDate: D("2026-11-01"), endDate: D("2027-10-31") },
    { serviceName: s("mail"), endClientName: "Bar Centrale", netCents: 3600, startDate: D("2026-11-01"), endDate: D("2026-11-30") },
  ];
  const fpBlock: T.FirstPaymentBlock = { payUrl: `${app}/pay/tok_first`, netCents: 27600, currency: "eur" };

  return [
    { id: "reminder-30-singolare", title: "Promemoria 30 gg — 1 servizio", content: rem("PROMEMORIA_30", one, 30, renewal(one)) },
    { id: "reminder-7-plurale", title: "Promemoria 7 gg — più servizi, cliente finale comune, prezzo bloccato misto", content: rem("PROMEMORIA_7", many, 7, renewal(many, true)) },
    { id: "reminder-autorinnovo", title: "Promemoria con rinnovo automatico attivo (nessuna sezione pagamento)", content: rem("PROMEMORIA_15", mixedEndClient, 15) },
    { id: "sollecito-singolare", title: "Sollecito — 1 servizio", content: rem("SOLLECITO", one, -2, renewal(one)) },
    { id: "sollecito-plurale", title: "Sollecito — più servizi", content: rem("SOLLECITO", mixedEndClient, -7, renewal(mixedEndClient)) },
    { id: "cessazione-singolare", title: "Cessazione — 1 servizio", content: rem("CESSAZIONE_MOROSITA", one, -11, { ...renewal(one), autoChargeUrl: null }) },
    { id: "cessazione-plurale", title: "Cessazione — più servizi", content: rem("CESSAZIONE_MOROSITA", many, -11, { ...renewal(many), autoChargeUrl: null }) },
    {
      id: "preavviso-addebito",
      title: "Preavviso addebito automatico",
      content: mod.buildAutoChargeUpcomingEmail({
        items: many, endDate: D("2026-11-30"), netCents: 27600, vatCents: 6072, serviceFeeCents: 505, totalCents: 34177, currency: "eur", lang,
      }),
    },
    {
      id: "preavviso-addebito-singolo",
      title: "Preavviso addebito automatico — 1 servizio, senza commissione",
      content: mod.buildAutoChargeUpcomingEmail({
        items: one, endDate: D("2026-11-30"), netCents: 24000, vatCents: 5280, serviceFeeCents: 0, totalCents: 29280, currency: "eur", lang,
      }),
    },
    {
      id: "conferma-rinnovo",
      title: "Conferma pagamento (rinnovo)",
      content: mod.buildConfirmationEmail({
        subscriptionId: "sub_demo", clientName, audience: "client", lang, method: "STRIPE", receiptToken: "rcpt_demo",
        items: [
          { serviceName: s("hosting"), endClientName: "Bar Centrale", amountCents: 29280, newEndDate: D("2027-11-30") },
          { serviceName: s("mail"), endClientName: null, amountCents: 4392, newEndDate: D("2026-12-30") },
        ],
        totalCents: 34177, taxableCents: 27600, vatCents: 6072, serviceFeeCents: 505, currency: "eur",
      }),
    },
    {
      id: "conferma-attivazione",
      title: "Conferma pagamento (attivazione, manuale, ricevuta in generazione)",
      content: mod.buildConfirmationEmail({
        subscriptionId: "sub_demo", clientName, audience: "client", lang, method: "MANUALE", receiptToken: null, activation: true,
        items: [{ serviceName: s("hosting"), endClientName: null, amountCents: 29280, newEndDate: D("2027-10-31") }],
        totalCents: 29280, taxableCents: 24000, vatCents: 5280, currency: "eur",
      }),
    },
    {
      id: "benvenuto",
      title: "Benvenuto — con primo pagamento, rinnovo automatico e dati",
      content: mod.buildWelcomeEmail({
        clientName, lang,
        items: [
          { serviceName: s("hosting"), endClientName: null, priceCents: 24000, quantity: 1, currency: "eur", billingPeriod: "ANNUALE", customPeriodDays: null, endDate: D("2027-10-31") },
          { serviceName: s("domain"), endClientName: "Studio Bianchi", priceCents: 1500, quantity: 2, currency: "eur", billingPeriod: "PERSONALIZZATA", customPeriodDays: 90, endDate: D("2027-01-29") },
        ],
        autoChargeUrl: `${app}/attiva-rinnovo/tok_demo`,
        dataEditUrl: `${app}/i-tuoi-dati/tok_data`,
        billingData: BILLING[lang],
        firstPayment: { payUrl: `${app}/pay/tok_first`, netCents: 27000, currency: "eur" },
      }),
    },
    {
      id: "benvenuto-semplice",
      title: "Benvenuto — servizi già attivi, senza extra",
      content: mod.buildWelcomeEmail({
        clientName, lang,
        items: [{ serviceName: s("mail"), endClientName: null, priceCents: 300, quantity: 1, currency: "eur", billingPeriod: "MENSILE", customPeriodDays: null, endDate: D("2026-11-30") }],
      }),
    },
    { id: "primo-pagamento", title: "Attivazione nuovi servizi", content: mod.buildFirstPaymentEmail({ clientName, items: fpItems, currency: "eur", payment: fpBlock, lang }) },
    { id: "primo-pagamento-sollecito", title: "Sollecito primo pagamento", content: mod.buildFirstPaymentReminderEmail({ clientName, items: fpItems, currency: "eur", payment: fpBlock, daysSinceLink: 3, lang }) },
    {
      id: "link-pagamento",
      title: "Link di pagamento",
      content: mod.buildPaymentLinkEmail({
        lang, currency: "eur", checkoutUrl: `${app}/pay/tok_demo`,
        items: [
          { serviceName: s("hosting"), endClientName: "Bar Centrale", amountCents: 24000, periodEnd: D("2027-11-30") },
          { serviceName: s("mail"), endClientName: null, amountCents: 3600, periodEnd: null },
        ],
      }),
    },
    {
      id: "richiesta-rinnovo-automatico",
      title: "Richiesta attivazione rinnovo automatico",
      content: mod.buildAutoChargeRequestEmail({
        lang, activationUrl: `${app}/attiva-rinnovo/tok_demo`,
        items: [
          { serviceName: s("hosting"), endClientName: "Bar Centrale", amountLabel: lang === "en" ? "€240.00" : "240,00 €", periodicityLabel: lang === "en" ? "Yearly" : "Annuale" },
          { serviceName: s("mail"), endClientName: null, amountLabel: lang === "en" ? "€36.00" : "36,00 €", periodicityLabel: lang === "en" ? "Monthly" : "Mensile" },
        ],
      }),
    },
    {
      id: "sollecito-attivazione",
      title: "Sollecito attivazione rinnovo automatico (2 richieste)",
      content: mod.buildAutoChargeReminderEmail({
        clientName, lang,
        requests: [
          { activationUrl: `${app}/attiva-rinnovo/tok_a`, requestedAt: D("2026-10-27"), items: many },
          { activationUrl: `${app}/attiva-rinnovo/tok_b`, requestedAt: D("2026-10-27"), items: [{ serviceName: s("domain") }] },
        ],
      }),
    },
    {
      id: "rimborso-parziale",
      title: "Rimborso parziale (rinnovo annullato + quota commissione)",
      content: mod.buildRefundConfirmationEmail({
        clientName, lang, currency: "eur", isTotal: false, totalCents: 4458, serviceFeeCents: 66,
        items: [{ serviceName: s("mail"), endClientName: "Bar Centrale", amountCents: 4392, renewalReverted: true }],
      }),
    },
    {
      id: "rimborso-totale",
      title: "Rimborso totale",
      content: mod.buildRefundConfirmationEmail({
        clientName, lang, currency: "eur", isTotal: true, totalCents: 33672,
        items: [
          { serviceName: s("hosting"), endClientName: null, amountCents: 29280, renewalReverted: false },
          { serviceName: s("mail"), endClientName: null, amountCents: 4392, renewalReverted: false },
        ],
      }),
    },
    {
      id: "verifica-dati",
      title: "Richiesta verifica dati di fatturazione",
      content: mod.buildDataUpdateRequestEmail({ clientName, lang, billingData: BILLING[lang], dataEditUrl: `${app}/i-tuoi-dati/tok_data` }),
    },
  ];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(p: Preview, lang: Lang): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(p.content.subject)}</title></head>
<body style="margin:0;padding:24px;background:#eef1f5">
<p style="font-family:monospace;font-size:12px;color:#475569;margin:0 0 4px">${lang.toUpperCase()} · ${esc(p.id)}</p>
<p style="font-family:sans-serif;font-size:14px;margin:0 0 16px"><strong>Oggetto:</strong> ${esc(p.content.subject)}</p>
${p.content.html}
<details style="max-width:560px;margin:16px auto;font-family:sans-serif;font-size:13px"><summary>Versione testo</summary><pre style="white-space:pre-wrap">${esc(p.content.text)}</pre></details>
</body></html>`;
}

function main() {
  const out = path.resolve(__dirname, "..", "tmp", "email-preview");
  fs.mkdirSync(out, { recursive: true });
  const it = samples("it");
  const en = samples("en");
  for (const [lang, list] of [["it", it], ["en", en]] as const) {
    for (const p of list) fs.writeFileSync(path.join(out, `${p.id}.${lang}.html`), page(p, lang));
  }
  const rows = it
    .map(
      (p, i) => `<section><h2>${esc(p.title)}</h2><div class="pair">
  <div><p>IT · ${esc(p.content.subject)}</p><iframe src="${p.id}.it.html"></iframe></div>
  <div><p>EN · ${esc(en[i].content.subject)}</p><iframe src="${p.id}.en.html"></iframe></div>
</div></section>`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(out, "index.html"),
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Anteprima email cliente</title>
<style>body{font-family:sans-serif;margin:24px;background:#f8fafc;color:#0f172a}h2{font-size:16px;margin:32px 0 8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair p{font-size:12px;color:#475569;margin:0 0 4px;font-family:monospace}
iframe{width:100%;height:900px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}</style></head>
<body><h1>Email cliente — IT / EN (${it.length} email)</h1>${rows}</body></html>`,
  );
  console.log(`Scritte ${it.length * 2} email + index.html in ${out}`);
}

if (require.main === module) main();
