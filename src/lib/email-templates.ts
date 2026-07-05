import "server-only";
import { NotificationType, type PaymentMethod } from "@prisma/client";
import { formatDate, formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { splitVatFromGross } from "@/lib/vat";

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

/** Tipi di notifica reminder personalizzabili da Impostazioni (esclude CONFERMA_ACQUISTO). */
export const REMINDER_CONFIGURABLE_TYPES = [
  "PROMEMORIA_30",
  "PROMEMORIA_15",
  "PROMEMORIA_7",
  "SOLLECITO",
  "CESSAZIONE_MOROSITA",
] as const;
export type ReminderConfigurableType =
  (typeof REMINDER_CONFIGURABLE_TYPES)[number];

/**
 * Testi di DEFAULT (oggetto/corpo/titolo) di ciascun reminder. subject e body
 * supportano i segnaposto: {clientName} {serviceName} {endDate} {diffDays}
 * {diffDaysAfter}. Usati sia come fallback quando non c'è override, sia come
 * placeholder nel form di Impostazioni.
 */
export const REMINDER_DEFAULTS: Record<
  ReminderConfigurableType,
  { subject: string; body: string; title: string }
> = {
  PROMEMORIA_30: {
    subject:
      "[Radar] Abbonamento in scadenza: {clientName} — {serviceName} (tra {diffDays} giorni)",
    body: "L'abbonamento sta per scadere: mancano {diffDays} giorni alla data di rinnovo.",
    title: "Abbonamento in scadenza",
  },
  PROMEMORIA_15: {
    subject:
      "[Radar] Abbonamento in scadenza: {clientName} — {serviceName} (tra {diffDays} giorni)",
    body: "L'abbonamento sta per scadere: mancano {diffDays} giorni alla data di rinnovo.",
    title: "Abbonamento in scadenza",
  },
  PROMEMORIA_7: {
    subject:
      "[Radar] Abbonamento in scadenza: {clientName} — {serviceName} (tra {diffDays} giorni)",
    body: "L'abbonamento sta per scadere: mancano {diffDays} giorni alla data di rinnovo.",
    title: "Abbonamento in scadenza",
  },
  SOLLECITO: {
    subject:
      "[Radar] Abbonamento scaduto: {clientName} — {serviceName} (scaduto da {diffDaysAfter} giorni)",
    body: "L'abbonamento risulta SCADUTO da {diffDaysAfter} giorni e non ancora rinnovato. Si consiglia di regolarizzare il pagamento o contattare il cliente al più presto.",
    title: "Abbonamento scaduto — sollecito",
  },
  CESSAZIONE_MOROSITA: {
    subject:
      "[Radar] Servizio cessato per mancato pagamento: {clientName} — {serviceName}",
    body: "Il servizio è stato CESSATO automaticamente per mancato pagamento, trascorsi i giorni previsti dalla scadenza senza rinnovo. Valuta se comunicare la cessazione al cliente.",
    title: "Servizio cessato per morosità",
  },
};

/** Sostituisce i segnaposto {token} con i valori del reminder. */
function fillReminderPlaceholders(tpl: string, d: ReminderEmailData): string {
  const diffDaysAfter = -d.diffDays;
  return tpl
    .replaceAll("{clientName}", d.clientName)
    .replaceAll("{serviceName}", d.serviceName)
    .replaceAll("{endDate}", formatDate(d.endDate))
    .replaceAll("{diffDays}", String(d.diffDays))
    .replaceAll("{diffDaysAfter}", String(diffDaysAfter));
}

/** Override testuale (oggetto/corpo) per un reminder; null/undefined = default. */
export type ReminderOverride = {
  subject?: string | null;
  body?: string | null;
};

/**
 * Genera oggetto + corpo (testo e HTML) per il tipo di notifica indicato.
 * Il destinatario (ADMIN_EMAIL) è gestito dal chiamante (cron).
 *
 * `override` (opzionale, da ReminderTemplate) sostituisce oggetto e/o corpo:
 * i campi vuoti/null ricadono sul default. Entrambi supportano i segnaposto.
 */
export function buildReminderEmail(
  type: NotificationType,
  d: ReminderEmailData,
  override?: ReminderOverride,
): EmailContent {
  const def = REMINDER_DEFAULTS[type as ReminderConfigurableType];

  // Type non gestito (es. CONFERMA_ACQUISTO ha il suo generatore).
  if (!def) {
    const subject = `[Radar] Notifica abbonamento: ${d.clientName} — ${d.serviceName}`;
    return { subject, text: detailsText(d), html: wrapHtml("Notifica abbonamento", "", d) };
  }

  const subjectTpl = override?.subject?.trim() ? override.subject : def.subject;
  const bodyTpl = override?.body?.trim() ? override.body : def.body;

  const subject = fillReminderPlaceholders(subjectTpl, d);
  const intro = fillReminderPlaceholders(bodyTpl, d);
  const text = `${intro}\n\n${detailsText(d)}`;

  return { subject, text, html: wrapHtml(def.title, intro, d) };
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
  // Scorporo IVA dal totale lordo (coerente con la ricevuta).
  const vat = splitVatFromGross(d.totalCents);
  const vatLine = `di cui imponibile ${formatEur(vat.taxableCents, currency)} + IVA 22% ${formatEur(vat.vatCents, currency)}`;
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
    `         (${vatLine})`,
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
          <tr>
            <td colspan="3" style="padding:2px 0 0;text-align:right;font-size:12px;color:#94a3b8">${vatLine}</td>
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
// BENVENUTO — email al cliente alla creazione del primo abbonamento
// ──────────────────────────────────────────────────────────────────────────

export type WelcomeEmailItem = {
  serviceName: string;
  priceCents: number; // prezzo unitario
  quantity: number; // ≥ 1
  currency?: string;
  billingPeriod: BillingPeriodValue;
  customPeriodDays: number | null;
};

export type WelcomeEmailData = {
  clientName: string;
  /** Servizi attivati con questo primo abbonamento. */
  items: WelcomeEmailItem[];
};

const CONTACT_EMAIL = "hello@deltasolutions.agency";

/**
 * Email di BENVENUTO inviata UNA sola volta per cliente, alla creazione del suo
 * primo abbonamento. Presenta la transizione Deltaweb → Delta Solutions Agency,
 * elenca i servizi attivati e spiega che Radar gestirà scadenze e pagamenti.
 * Rivolta al cliente: solo link pubblici (privacy/termini), nessun link interno.
 */
export function buildWelcomeEmail(d: WelcomeEmailData): EmailContent {
  const base = process.env.APP_URL ?? "";
  const privacyUrl = `${base}/privacy`;
  const termsUrl = `${base}/termini`;

  const subject = "Benvenuto in Delta Solutions Agency — la tua area Radar";

  const intro =
    "Ti diamo il benvenuto! Deltaweb è ora Delta Solutions Agency: cambiano il nome e l'immagine, ma restano lo stesso team e la stessa cura dei tuoi servizi. Da oggi la gestione di scadenze, rinnovi e pagamenti passa attraverso Radar, la nostra piattaforma dedicata.";

  const explanation =
    "Con Radar riceverai promemoria automatici prima di ogni scadenza, link di pagamento sicuri e le ricevute dei tuoi rinnovi, tutto in un unico posto. Non devi fare nulla: ci pensiamo noi a tenere tutto in ordine.";

  const itemLabel = (it: WelcomeEmailItem) => {
    const name = it.quantity > 1 ? `${it.serviceName} ×${it.quantity}` : it.serviceName;
    const period = formatBillingPeriod(it.billingPeriod, it.customPeriodDays);
    const price = formatEur(it.priceCents * it.quantity, it.currency ?? "eur");
    return { name, period, price };
  };

  const itemLinesText = d.items.map((it) => {
    const { name, period, price } = itemLabel(it);
    return `- ${name}: ${price} · ${period}`;
  });

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    "",
    "Servizi attivati:",
    ...itemLinesText,
    "",
    explanation,
    "",
    `Privacy Policy: ${privacyUrl}`,
    `Termini e Condizioni: ${termsUrl}`,
    "",
    `Per qualsiasi domanda scrivici a ${CONTACT_EMAIL}.`,
    "",
    "Il team di Delta Solutions Agency",
  ].join("\n");

  const itemRowsHtml = d.items
    .map((it) => {
      const { name, period, price } = itemLabel(it);
      return `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${name}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${period}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${price}</td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Benvenuto in Delta Solutions Agency</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName},</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">Servizio</th>
            <th style="padding:0 12px 6px 0;font-weight:500">Periodicità</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">Prezzo</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <p style="font-size:14px;line-height:1.5">${explanation}</p>
      <p style="font-size:13px;color:#64748b;line-height:1.6">
        Consulta la nostra <a href="${privacyUrl}" style="color:#4f46e5">Privacy Policy</a>
        e i <a href="${termsUrl}" style="color:#4f46e5">Termini e Condizioni</a>.<br/>
        Per qualsiasi domanda scrivici a
        <a href="mailto:${CONTACT_EMAIL}" style="color:#4f46e5">${CONTACT_EMAIL}</a>.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions Agency</p>
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
    "Puoi attivare il rinnovo automatico del tuo abbonamento: registrando una sola carta autorizzi l'addebito ricorrente per tutti i tuoi servizi attivi presso Delta Solutions, ciascuno alla propria cadenza. Nella pagina di attivazione vedrai l'elenco completo. Puoi revocare l'autorizzazione in qualsiasi momento scrivendo a hello@deltasolutions.agency.";

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
// CONFERMA STORNO / RIMBORSO — email al cliente
// ──────────────────────────────────────────────────────────────────────────

export type RefundConfirmationItem = {
  serviceName: string;
  amountCents: number;
  /** true se il rinnovo di questo servizio è stato annullato dallo storno. */
  renewalReverted: boolean;
};

export type RefundConfirmationData = {
  clientName: string;
  /** Servizi rimborsati in questo storno. */
  items: RefundConfirmationItem[];
  /** Importo totale rimborsato (somma delle righe stornate). */
  totalCents: number;
  currency?: string;
  /** true se lo storno è totale (tutto il pagamento), false se parziale. */
  isTotal: boolean;
};

/**
 * Email al cliente che conferma un rimborso (storno) parziale o totale: elenca i
 * servizi rimborsati, l'importo e se il rinnovo di quei servizi è stato
 * annullato. Rivolta al cliente: nessun link interno.
 */
export function buildRefundConfirmationEmail(
  d: RefundConfirmationData,
): EmailContent {
  const currency = d.currency ?? "eur";
  const total = formatEur(d.totalCents, currency);
  const label = servicesLabel(d.items);
  const anyReverted = d.items.some((it) => it.renewalReverted);

  const subject = `Radar — Rimborso effettuato: ${label}`;
  const intro = `Abbiamo effettuato un rimborso ${
    d.isTotal ? "totale" : "parziale"
  } sul tuo pagamento. Di seguito il dettaglio.`;

  const renewalNote = anyReverted
    ? "Il rinnovo dei servizi rimborsati contrassegnati è stato annullato: la scadenza è tornata a quella precedente."
    : null;

  const itemLinesText = d.items.map(
    (it) =>
      `- ${it.serviceName}: ${formatEur(it.amountCents, currency)}${
        it.renewalReverted ? " (rinnovo annullato)" : ""
      }`,
  );

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    "",
    "Servizi rimborsati:",
    ...itemLinesText,
    "",
    `Totale rimborsato: ${total}`,
    ...(renewalNote ? ["", renewalNote] : []),
    "",
    "Il rimborso sarà visibile sul tuo metodo di pagamento entro qualche giorno lavorativo, secondo i tempi della tua banca.",
    "",
    "Per qualsiasi domanda scrivici a hello@deltasolutions.agency.",
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${it.serviceName}${
            it.renewalReverted
              ? ` <span style="color:#94a3b8;font-size:12px">— rinnovo annullato</span>`
              : ""
          }</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency)}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Rimborso effettuato</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName},</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">Totale rimborsato</td>
            <td style="padding:8px 0 0;font-weight:600;text-align:right">${total}</td>
          </tr>
        </tfoot>
      </table>
      ${
        renewalNote
          ? `<p style="font-size:13px;color:#64748b;line-height:1.5">${renewalNote}</p>`
          : ""
      }
      <p style="font-size:13px;color:#64748b;line-height:1.5">Il rimborso sarà visibile sul tuo metodo di pagamento entro qualche giorno lavorativo, secondo i tempi della tua banca.</p>
      <p style="font-size:13px;color:#64748b;line-height:1.5">Per qualsiasi domanda scrivici a <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
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
