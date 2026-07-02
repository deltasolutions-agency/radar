import "server-only";
import { NotificationType, type PaymentMethod } from "@prisma/client";
import { formatDate, formatEur } from "@/lib/format";

/**
 * Dati necessari a comporre le email di reminder/sollecito/cessazione.
 * clientName/serviceName sono i valori correnti (join live nel cron): le email
 * sono comunicazioni operative per l'admin, non documenti immutabili.
 */
export type ReminderEmailData = {
  subscriptionId: string;
  clientName: string;
  serviceName: string;
  endDate: Date;
  /** Giorni mancanti alla scadenza (negativo se già scaduto). */
  diffDays: number;
};

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function detailUrl(subscriptionId: string): string {
  const base = process.env.APP_URL ?? "";
  return `${base}/abbonamenti/${subscriptionId}`;
}

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

/**
 * Header brandizzato condiviso da OGNI email inviata da Radar: logo Delta
 * Solutions + payoff "Radar" (Space Mono con fallback di sistema, dato che i
 * client email non caricano font custom) + separatore leggero.
 */
function emailHeaderHtml(): string {
  return `
    <div style="margin-bottom:16px">
      <img src="${LOGO_URL}" alt="Delta Solutions" style="height:40px;display:block;margin-bottom:4px;" />
      <p style="margin:0;font-family:'Space Mono','Courier New',monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#64748b">Radar</p>
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px" />`;
}

/** Blocco dati comune (testo semplice). */
function detailsText(d: ReminderEmailData): string {
  return [
    `Cliente:   ${d.clientName}`,
    `Servizio:  ${d.serviceName}`,
    `Scadenza:  ${formatDate(d.endDate)}`,
    `Dettaglio: ${detailUrl(d.subscriptionId)}`,
  ].join("\n");
}

/** Blocco dati comune (HTML). */
function detailsHtml(d: ReminderEmailData): string {
  const url = detailUrl(d.subscriptionId);
  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Cliente</td><td>${d.clientName}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Scadenza</td><td>${formatDate(d.endDate)}</td></tr>
    </table>
    <p style="font-family:sans-serif;font-size:14px">
      <a href="${url}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>
    </p>`;
}

function wrapHtml(title: string, intro: string, d: ReminderEmailData): string {
  return `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${title}</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${detailsHtml(d)}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · notifica automatica</p>
    </div>`;
}

/**
 * Genera oggetto + corpo (testo e HTML) per il tipo di notifica indicato.
 * Il destinatario (ADMIN_EMAIL) è gestito dal chiamante (cron).
 */
export function buildReminderEmail(
  type: NotificationType,
  d: ReminderEmailData,
): EmailContent {
  const diffDaysAfter = -d.diffDays;

  switch (type) {
    case "PROMEMORIA_30":
    case "PROMEMORIA_15":
    case "PROMEMORIA_7": {
      const subject = `[Radar] Abbonamento in scadenza: ${d.clientName} — ${d.serviceName} (tra ${d.diffDays} giorni)`;
      const intro = `L'abbonamento sta per scadere: mancano ${d.diffDays} giorni alla data di rinnovo.`;
      const text = `${intro}\n\n${detailsText(d)}`;
      return {
        subject,
        text,
        html: wrapHtml("Abbonamento in scadenza", intro, d),
      };
    }

    case "SOLLECITO": {
      const subject = `[Radar] Abbonamento scaduto: ${d.clientName} — ${d.serviceName} (scaduto da ${diffDaysAfter} giorni)`;
      const intro = `L'abbonamento risulta SCADUTO da ${diffDaysAfter} giorni e non ancora rinnovato. Si consiglia di regolarizzare il pagamento o contattare il cliente al più presto.`;
      const text = `${intro}\n\n${detailsText(d)}`;
      return {
        subject,
        text,
        html: wrapHtml("Abbonamento scaduto — sollecito", intro, d),
      };
    }

    case "CESSAZIONE_MOROSITA": {
      const subject = `[Radar] Servizio cessato per mancato pagamento: ${d.clientName} — ${d.serviceName}`;
      const intro = `Il servizio è stato CESSATO automaticamente per mancato pagamento, trascorsi 11 giorni dalla scadenza senza rinnovo. Valuta se comunicare la cessazione al cliente.`;
      const text = `${intro}\n\n${detailsText(d)}`;
      return {
        subject,
        text,
        html: wrapHtml("Servizio cessato per morosità", intro, d),
      };
    }

    default: {
      // Type non gestiti da questo generatore (es. CONFERMA_ACQUISTO ha il suo).
      const subject = `[Radar] Notifica abbonamento: ${d.clientName} — ${d.serviceName}`;
      const text = detailsText(d);
      return {
        subject,
        text,
        html: wrapHtml("Notifica abbonamento", "", d),
      };
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// CONFERMA_ACQUISTO — email di conferma pagamento
// ──────────────────────────────────────────────────────────────────────────

export type ConfirmationEmailData = {
  subscriptionId: string;
  clientName: string;
  serviceName: string;
  amountCents: number;
  currency?: string;
  /** Nuova scadenza dopo il rinnovo. */
  endDate: Date;
  method: PaymentMethod;
  /** Token della ricevuta pubblica; se assente il link viene omesso. */
  receiptToken?: string | null;
  /**
   * "admin" (default): include il link al dettaglio dashboard.
   * "client": tono rivolto al cliente, SOLO ricevuta pubblica, MAI link interni.
   */
  audience?: "admin" | "client";
};

function methodLabel(method: PaymentMethod): string {
  return method === "STRIPE"
    ? "Carta di credito (Stripe)"
    : "Pagamento manuale";
}

/**
 * Email di conferma pagamento (CONFERMA_ACQUISTO): riepilogo importo/servizio/
 * nuova scadenza/metodo + link alla ricevuta pubblica (se disponibile) e al
 * dettaglio abbonamento.
 */
export function buildConfirmationEmail(
  d: ConfirmationEmailData,
): EmailContent {
  const audience = d.audience ?? "admin";
  const isClient = audience === "client";

  const amount = formatEur(d.amountCents, d.currency ?? "eur");
  const base = process.env.APP_URL ?? "";
  const receiptUrl = d.receiptToken ? `${base}/r/${d.receiptToken}` : null;
  // Link dashboard SOLO per l'admin — mai nella versione cliente.
  const detail = isClient ? null : `${base}/abbonamenti/${d.subscriptionId}`;

  const subject = isClient
    ? `Radar — Pagamento ricevuto: ${d.serviceName}`
    : `[Radar] Pagamento confermato: ${d.clientName} — ${d.serviceName}`;

  const intro = isClient
    ? "Grazie! Abbiamo ricevuto il tuo pagamento. Di seguito il riepilogo."
    : "Abbiamo registrato il pagamento per l'abbonamento.";

  const receiptLineText = receiptUrl
    ? `Ricevuta:  ${receiptUrl}`
    : "Ricevuta:  in generazione, sarà disponibile a breve.";

  const textLines = [
    intro,
    "",
    `Servizio:       ${d.serviceName}`,
    ...(isClient ? [] : [`Cliente:        ${d.clientName}`]),
    `Importo:        ${amount}`,
    `Metodo:         ${methodLabel(d.method)}`,
    `Nuova scadenza: ${formatDate(d.endDate)}`,
    "",
    receiptLineText,
    ...(detail ? [`Dettaglio: ${detail}`] : []),
  ];
  const text = textLines.join("\n");

  const clientRow = isClient
    ? ""
    : `<tr><td style="padding:2px 12px 2px 0;color:#64748b">Cliente</td><td>${d.clientName}</td></tr>`;

  const receiptLinkHtml = receiptUrl
    ? `<a href="${receiptUrl}" style="color:#4f46e5">Visualizza la ricevuta →</a><br/>`
    : `<span style="color:#64748b">Ricevuta in generazione, disponibile a breve.</span><br/>`;

  const detailLinkHtml = detail
    ? `<a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>`
    : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${isClient ? "Pagamento ricevuto" : "Pagamento confermato"}</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
        ${clientRow}
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Importo</td><td>${amount}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Metodo</td><td>${methodLabel(d.method)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Nuova scadenza</td><td>${formatDate(d.endDate)}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:14px">
        ${receiptLinkHtml}
        ${detailLinkHtml}
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// LINK DI PAGAMENTO — email al cliente (self-service Stripe)
// ──────────────────────────────────────────────────────────────────────────

export type PaymentLinkEmailData = {
  serviceName: string;
  amountCents: number;
  currency?: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  /** URL reale della Stripe Checkout Session (session.url). */
  checkoutUrl: string;
  /** Scadenza del link (72h). */
  expiresAt: Date;
};

/**
 * Email al cliente con il link di pagamento Stripe (Checkout Session).
 * Rivolta al cliente: contiene SOLO il link Checkout reale, mai link interni.
 */
export function buildPaymentLinkEmail(d: PaymentLinkEmailData): EmailContent {
  const amount = formatEur(d.amountCents, d.currency ?? "eur");
  const period =
    d.periodStart && d.periodEnd
      ? `${formatDate(d.periodStart)} → ${formatDate(d.periodEnd)}`
      : null;

  const subject = `Radar — Link di pagamento: ${d.serviceName}`;
  const intro =
    "Puoi completare il pagamento del tuo abbonamento tramite il link sicuro qui sotto.";

  const text = [
    intro,
    "",
    `Servizio: ${d.serviceName}`,
    `Importo:  ${amount}`,
    ...(period ? [`Periodo:  ${period}`] : []),
    "",
    `Paga ora: ${d.checkoutUrl}`,
    "",
    `Il link scade il ${formatDate(d.expiresAt)} (72 ore).`,
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Link di pagamento</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Importo</td><td>${amount}</td></tr>
        ${period ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b">Periodo</td><td>${period}</td></tr>` : ""}
      </table>
      <p style="margin:20px 0">
        <a href="${d.checkoutUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Paga ora →</a>
      </p>
      <p style="font-size:12px;color:#64748b">Il link scade il ${formatDate(d.expiresAt)} (72 ore dall'invio).</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}
