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
  const subject = `[Radar] Pagamento confermato: ${d.clientName} — ${d.serviceName}`;
  const amount = formatEur(d.amountCents, d.currency ?? "eur");
  const base = process.env.APP_URL ?? "";
  const receiptUrl = d.receiptToken ? `${base}/r/${d.receiptToken}` : null;
  const detail = `${base}/abbonamenti/${d.subscriptionId}`;

  const intro = "Abbiamo registrato il pagamento per l'abbonamento.";

  const text = [
    intro,
    "",
    `Servizio:       ${d.serviceName}`,
    `Cliente:        ${d.clientName}`,
    `Importo:        ${amount}`,
    `Metodo:         ${methodLabel(d.method)}`,
    `Nuova scadenza: ${formatDate(d.endDate)}`,
    "",
    receiptUrl
      ? `Ricevuta:  ${receiptUrl}`
      : "Ricevuta:  in generazione, disponibile a breve nel pannello abbonamento.",
    `Dettaglio: ${detail}`,
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      <h2 style="font-size:18px;margin:0 0 8px">Pagamento confermato</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Cliente</td><td>${d.clientName}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Importo</td><td>${amount}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Metodo</td><td>${methodLabel(d.method)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Nuova scadenza</td><td>${formatDate(d.endDate)}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:14px">
        ${
          receiptUrl
            ? `<a href="${receiptUrl}" style="color:#4f46e5">Visualizza la ricevuta →</a><br/>`
            : `<span style="color:#64748b">Ricevuta in generazione, disponibile a breve nel pannello.</span><br/>`
        }
        <a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · notifica automatica</p>
    </div>`;

  return { subject, text, html };
}
