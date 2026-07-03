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

export type ConfirmationEmailItem = {
  serviceName: string;
  amountCents: number;
  /** Nuova scadenza dopo il rinnovo (o scadenza corrente se il rinnovo è saltato). */
  newEndDate: Date;
};

export type ConfirmationEmailData = {
  subscriptionId: string;
  clientName: string;
  /** Una voce per ciascun servizio pagato in questo pagamento. */
  items: ConfirmationEmailItem[];
  /** Totale del pagamento (somma delle righe). */
  totalCents: number;
  currency?: string;
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

/** Etichetta breve dei servizi per l'oggetto: nome singolo o "N servizi". */
function servicesLabel(items: { serviceName: string }[]): string {
  return items.length === 1 ? items[0].serviceName : `${items.length} servizi`;
}

/**
 * Email di conferma pagamento (CONFERMA_ACQUISTO): elenco dei servizi pagati
 * (nome, importo, nuova scadenza) con totale in evidenza, metodo + link alla
 * ricevuta pubblica (se disponibile) e al dettaglio abbonamento.
 */
export function buildConfirmationEmail(
  d: ConfirmationEmailData,
): EmailContent {
  const audience = d.audience ?? "admin";
  const isClient = audience === "client";
  const currency = d.currency ?? "eur";

  const total = formatEur(d.totalCents, currency);
  const base = process.env.APP_URL ?? "";
  const receiptUrl = d.receiptToken ? `${base}/r/${d.receiptToken}` : null;
  // Link dashboard SOLO per l'admin — mai nella versione cliente.
  const detail = isClient ? null : `${base}/abbonamenti/${d.subscriptionId}`;
  const label = servicesLabel(d.items);

  const subject = isClient
    ? `Radar — Pagamento ricevuto: ${label}`
    : `[Radar] Pagamento confermato: ${d.clientName} — ${label}`;

  const intro = isClient
    ? "Grazie! Abbiamo ricevuto il tuo pagamento. Di seguito il riepilogo."
    : "Abbiamo registrato il pagamento per l'abbonamento.";

  const receiptLineText = receiptUrl
    ? `Ricevuta:  ${receiptUrl}`
    : "Ricevuta:  in generazione, sarà disponibile a breve.";

  // Nota fatturazione: solo nella versione cliente.
  const invoiceNote =
    "Riceverai la fattura relativa a questo pagamento entro 12 giorni lavorativi.";

  const itemLinesText = d.items.map(
    (it) =>
      `- ${it.serviceName}: ${formatEur(it.amountCents, currency)} · nuova scadenza ${formatDate(it.newEndDate)}`,
  );

  const textLines = [
    intro,
    "",
    ...(isClient ? [] : [`Cliente: ${d.clientName}`, ""]),
    "Servizi:",
    ...itemLinesText,
    "",
    `Totale:  ${total}`,
    `Metodo:  ${methodLabel(d.method)}`,
    "",
    receiptLineText,
    ...(detail ? [`Dettaglio: ${detail}`] : []),
    ...(isClient ? ["", invoiceNote] : []),
  ];
  const text = textLines.join("\n");

  const clientRowHtml = isClient
    ? ""
    : `<p style="font-family:sans-serif;font-size:14px;margin:0 0 8px"><span style="color:#64748b">Cliente:</span> ${d.clientName}</p>`;

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${it.serviceName}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;color:#64748b">${formatDate(it.newEndDate)}</td>
        </tr>`,
    )
    .join("");

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
      ${clientRowHtml}
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">Servizio</th>
            <th style="padding:0 12px 6px 0;font-weight:500;text-align:right">Importo</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">Nuova scadenza</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">Totale</td>
            <td style="padding:8px 12px 0 0;font-weight:600;text-align:right">${total}</td>
            <td style="padding:8px 0 0"></td>
          </tr>
        </tfoot>
      </table>
      <p style="font-family:sans-serif;font-size:14px;margin-top:8px">
        <span style="color:#64748b">Metodo:</span> ${methodLabel(d.method)}
      </p>
      <p style="font-family:sans-serif;font-size:14px">
        ${receiptLinkHtml}
        ${detailLinkHtml}
      </p>
      ${
        isClient
          ? `<p style="font-size:13px;color:#64748b;line-height:1.5">${invoiceNote}</p>`
          : ""
      }
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// RICHIESTA ATTIVAZIONE RINNOVO AUTOMATICO — email al cliente
// ──────────────────────────────────────────────────────────────────────────

/**
 * Email al cliente con il link per attivare il rinnovo automatico (registrazione
 * carta con gate di consenso). Rivolta al cliente: solo il link pubblico
 * /attiva-rinnovo, mai link interni.
 */
export function buildAutoChargeRequestEmail(d: {
  serviceName: string;
  amountLabel: string;
  periodicityLabel: string;
  activationUrl: string;
}): EmailContent {
  const subject = `Radar — Attiva il rinnovo automatico per ${d.serviceName}`;
  const intro =
    "Puoi attivare il rinnovo automatico del tuo abbonamento: registrando la carta autorizzi l'addebito ricorrente alla cadenza indicata. Puoi revocare l'autorizzazione in qualsiasi momento scrivendo a hello@deltasolutions.agency.";

  const text = [
    intro,
    "",
    `Servizio:     ${d.serviceName}`,
    `Importo:      ${d.amountLabel}`,
    `Periodicità:  ${d.periodicityLabel}`,
    "",
    `Attiva ora: ${d.activationUrl}`,
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Attiva il rinnovo automatico</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Importo</td><td>${d.amountLabel}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Periodicità</td><td>${d.periodicityLabel}</td></tr>
      </table>
      <p style="margin:20px 0">
        <a href="${d.activationUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva rinnovo automatico →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// ADDEBITO AUTOMATICO FALLITO — notifica admin
// ──────────────────────────────────────────────────────────────────────────

export type AutoChargeFailedItem = {
  serviceName: string;
  /** Motivo specifico della riga, se diverso dal motivo comune del gruppo. */
  reason?: string;
};

/**
 * Notifica all'admin che l'addebito automatico di un gruppo di righe è fallito
 * due volte: il rinnovo automatico è stato disattivato sulle righe elencate ed è
 * stato inviato al cliente un link di pagamento manuale di fallback.
 */
export function buildAutoChargeFailedAdminEmail(d: {
  subscriptionId: string;
  clientName: string;
  /** Righe (servizi) su cui l'addebito automatico è stato disattivato. */
  items: AutoChargeFailedItem[];
  /** Motivo comune del fallimento del gruppo (es. errore Stripe). */
  reason?: string;
}): EmailContent {
  const base = process.env.APP_URL ?? "";
  const detail = `${base}/abbonamenti/${d.subscriptionId}`;
  const label = servicesLabel(d.items);
  const subject = `[Radar] Addebito automatico fallito: ${d.clientName} — ${label}`;
  const intro = `L'addebito automatico è fallito due volte consecutive per ${d.clientName}. Il rinnovo automatico è stato disattivato sulle righe seguenti ed è stato inviato al cliente un link di pagamento manuale di fallback.`;

  // Motivo per riga: quello specifico se presente, altrimenti quello comune.
  const reasonOf = (it: AutoChargeFailedItem) => it.reason ?? d.reason;

  const text = [
    intro,
    "",
    "Servizi disattivati:",
    ...d.items.map((it) => {
      const r = reasonOf(it);
      return `- ${it.serviceName}${r ? ` — ${r}` : ""}`;
    }),
    "",
    `Dettaglio: ${detail}`,
  ].join("\n");

  const itemsHtml = d.items
    .map((it) => {
      const r = reasonOf(it);
      return `<li style="margin-bottom:2px">${it.serviceName}${r ? ` <span style="color:#94a3b8">— ${r}</span>` : ""}</li>`;
    })
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Addebito automatico fallito</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <ul style="font-family:sans-serif;font-size:14px;color:#1e293b;padding-left:18px;margin:8px 0">${itemsHtml}</ul>
      <p style="font-family:sans-serif;font-size:14px">
        <a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · notifica automatica</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// LINK DI PAGAMENTO — email al cliente (self-service Stripe)
// ──────────────────────────────────────────────────────────────────────────

export type PaymentLinkEmailItem = {
  serviceName: string;
  amountCents: number;
  /** Fine del periodo coperto da questa riga (opzionale). */
  periodEnd?: Date | null;
};

export type PaymentLinkEmailData = {
  /** Una voce per ciascun servizio incluso nel link di pagamento. */
  items: PaymentLinkEmailItem[];
  /** Totale del pagamento (somma delle righe). */
  totalCents: number;
  currency?: string;
  /** URL della pagina di pagamento (gate consenso) o Checkout reale. */
  checkoutUrl: string;
  /** Scadenza del link (max 24h). */
  expiresAt: Date;
};

/**
 * Email al cliente con il link di pagamento Stripe. Rivolta al cliente:
 * elenca i servizi inclusi con relativo importo, il totale e il pulsante
 * "Paga ora". Contiene SOLO il link di pagamento, mai link interni.
 */
export function buildPaymentLinkEmail(d: PaymentLinkEmailData): EmailContent {
  const currency = d.currency ?? "eur";
  const total = formatEur(d.totalCents, currency);
  const label = servicesLabel(d.items);

  const subject = `Radar — Link di pagamento: ${label}`;
  const intro =
    "Puoi completare il pagamento del tuo abbonamento tramite il link sicuro qui sotto.";

  const itemLinesText = d.items.map((it) => {
    const per = it.periodEnd ? ` (fino al ${formatDate(it.periodEnd)})` : "";
    return `- ${it.serviceName}: ${formatEur(it.amountCents, currency)}${per}`;
  });

  const text = [
    intro,
    "",
    "Servizi:",
    ...itemLinesText,
    "",
    `Totale:   ${total}`,
    "",
    `Paga ora: ${d.checkoutUrl}`,
    "",
    `Il link scade il ${formatDate(d.expiresAt)} (24 ore).`,
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${it.serviceName}${it.periodEnd ? `<br/><span style="color:#94a3b8;font-size:12px">fino al ${formatDate(it.periodEnd)}</span>` : ""}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency)}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Link di pagamento</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">Totale</td>
            <td style="padding:8px 0 0;font-weight:600;text-align:right">${total}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin:20px 0">
        <a href="${d.checkoutUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Paga ora →</a>
      </p>
      <p style="font-size:12px;color:#64748b">Il link scade il ${formatDate(d.expiresAt)} (24 ore dall'invio).</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}
