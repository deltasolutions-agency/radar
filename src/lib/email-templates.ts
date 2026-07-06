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

/**
 * Header brandizzato condiviso da OGNI email inviata da Radar: logo Delta
 * Solutions + payoff "Radar" (Space Mono con fallback di sistema, dato che i
 * client email non caricano font custom) + separatore leggero.
 *
 * Il logo è servito dal dominio Radar (public/logo-delta-solutions.png): le
 * email richiedono un URL assoluto, quindi si usa APP_URL.
 */
function emailHeaderHtml(): string {
  const logoUrl = `${process.env.APP_URL ?? ""}/logo-delta-solutions.png`;
  return `
    <div style="margin-bottom:16px">
      <img src="${logoUrl}" alt="Delta Solutions" style="height:40px;display:block;margin-bottom:4px;" />
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

/**
 * Testi di DEFAULT rivolti al CLIENTE (destinatario = client.email). Tono diretto
 * verso il cliente, nessun riferimento a "contattare il cliente"/dashboard.
 * Non personalizzabili da Impostazioni (gli override lì valgono per l'admin).
 */
const REMINDER_CLIENT_DEFAULTS: Record<
  ReminderConfigurableType,
  { subject: string; body: string; title: string }
> = {
  PROMEMORIA_30: {
    subject: "Il tuo servizio {serviceName} è in scadenza",
    body: "ti ricordiamo che il tuo servizio {serviceName} scadrà il {endDate} (tra {diffDays} giorni). Per non interromperlo, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "Il tuo servizio è in scadenza",
  },
  PROMEMORIA_15: {
    subject: "Il tuo servizio {serviceName} è in scadenza",
    body: "ti ricordiamo che il tuo servizio {serviceName} scadrà il {endDate} (tra {diffDays} giorni). Per non interromperlo, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "Il tuo servizio è in scadenza",
  },
  PROMEMORIA_7: {
    subject: "Il tuo servizio {serviceName} è in scadenza",
    body: "ti ricordiamo che il tuo servizio {serviceName} scadrà il {endDate} (tra {diffDays} giorni). Per non interromperlo, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "Il tuo servizio è in scadenza",
  },
  SOLLECITO: {
    subject: "Il tuo servizio {serviceName} è scaduto",
    body: "il tuo servizio {serviceName} è scaduto il {endDate} e non risulta ancora rinnovato. Ti invitiamo a regolarizzare il pagamento al più presto per evitare l'interruzione del servizio.",
    title: "Il tuo servizio è scaduto",
  },
  CESSAZIONE_MOROSITA: {
    subject: "Il tuo servizio {serviceName} è stato cessato",
    body: "ti informiamo che il servizio {serviceName} è stato cessato per mancato rinnovo, trascorsi i giorni previsti dalla scadenza. Se desideri riattivarlo, contattaci il prima possibile.",
    title: "Il tuo servizio è stato cessato",
  },
};

const CONTACT_LINE_TEXT =
  "Per qualsiasi domanda scrivici a hello@deltasolutions.agency.";

/** Blocco dettagli per il CLIENTE (solo servizio + scadenza, nessun link admin). */
function clientDetailsText(d: ReminderEmailData): string {
  return [`Servizio:  ${d.serviceName}`, `Scadenza:  ${formatDate(d.endDate)}`].join(
    "\n",
  );
}

function clientDetailsHtml(d: ReminderEmailData): string {
  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Servizio</td><td>${d.serviceName}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Scadenza</td><td>${formatDate(d.endDate)}</td></tr>
    </table>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Sezione COORDINATE BANCARIE per il rinnovo (solo reminder CLIENTE su item
// senza rinnovo automatico). Stile coerente con la card della lettera di
// benvenuto: bordo sinistro blu, sfondo tenue.
// ──────────────────────────────────────────────────────────────────────────

const RENEWAL_BANK = {
  beneficiary: "Andrea Trinca",
  iban: "IT40L0366901600715069802019",
  swift: "REVOITM2",
} as const;

const RENEWAL_DISCLAIMER_A =
  "Questo importo si riferisce al rinnovo per la prossima annualità. Il prezzo dei rinnovi successivi potrebbe variare, in aumento o in diminuzione, rispetto a quello indicato.";

const RENEWAL_DISCLAIMER_CESSATION =
  "Il tuo servizio è stato sospeso per mancato rinnovo. Effettuando il pagamento del rinnovo, faremo il possibile per riattivarlo; se la riattivazione non fosse possibile, valuteremo un rimborso. In alcuni casi potrebbero essere necessari ulteriori accordi economici per il ripristino del servizio. Ti invitiamo a contattarci a hello@deltasolutions.agency prima di procedere al bonifico, per verificare la situazione specifica del tuo servizio.";

/**
 * Dati per la sezione rinnovo del reminder CLIENTE. La presenza di questo
 * oggetto indica che l'item NON ha il rinnovo automatico attivo (autoChargeEnabled
 * false): va mostrata la sezione coordinate + disclaimer. `autoChargeUrl` è
 * valorizzato solo nel Caso A (promemoria/sollecito) per la CTA di attivazione;
 * assente per la cessazione (Caso B).
 */
export type ClientRenewalInfo = {
  /** priceCents × quantity dell'item (nessuna IVA scorporata, nessun costo servizio). */
  amountCents: number;
  currency: string;
  autoChargeUrl?: string | null;
};

/** Coordinate bancarie, versione testo. */
function bankSectionText(amountLabel: string): string {
  return [
    "Istruzioni per il rinnovo:",
    `1. Effettuare bonifico a: ${RENEWAL_BANK.beneficiary}`,
    `2. IBAN: ${RENEWAL_BANK.iban}`,
    `3. SWIFT (o BIC): ${RENEWAL_BANK.swift}`,
    `4. Totale: ${amountLabel}`,
  ].join("\n");
}

/** Coordinate bancarie, versione HTML (card con bordo sinistro blu). */
function bankSectionHtml(amountLabel: string): string {
  return `
    <div style="margin:16px 0;border:1px solid #E2DED6;border-left:4px solid #2B7FFF;border-radius:8px;background:#FAFAFA;padding:14px 16px">
      <p style="font-size:14px;font-weight:600;margin:0 0 8px;color:#12161F">Istruzioni per il rinnovo</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#4A463F">
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">1.</td><td>Effettuare bonifico a: ${RENEWAL_BANK.beneficiary}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">2.</td><td>IBAN: <span style="font-family:'Space Mono','Courier New',monospace">${RENEWAL_BANK.iban}</span></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">3.</td><td>SWIFT (o BIC): <span style="font-family:'Space Mono','Courier New',monospace">${RENEWAL_BANK.swift}</span></td></tr>
        <tr><td style="padding:6px 8px 2px 0;color:#94a3b8">4.</td><td style="padding-top:4px"><strong>Totale: ${amountLabel}</strong></td></tr>
      </table>
    </div>`;
}

/** Blocchi testo (coordinate + disclaimer + eventuale CTA) per il reminder cliente. */
function clientRenewalText(
  info: ClientRenewalInfo,
  isCessation: boolean,
): string[] {
  const amountLabel = formatEur(info.amountCents, info.currency);
  const blocks = ["", bankSectionText(amountLabel), ""];
  blocks.push(
    isCessation ? RENEWAL_DISCLAIMER_CESSATION : RENEWAL_DISCLAIMER_A,
  );
  if (!isCessation && info.autoChargeUrl) {
    blocks.push(
      "",
      `Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico: ${info.autoChargeUrl}`,
    );
  }
  return blocks;
}

/** Blocco HTML (coordinate + disclaimer + eventuale CTA) per il reminder cliente. */
function clientRenewalHtml(
  info: ClientRenewalInfo,
  isCessation: boolean,
): string {
  const amountLabel = formatEur(info.amountCents, info.currency);
  const disclaimer = isCessation
    ? RENEWAL_DISCLAIMER_CESSATION
    : RENEWAL_DISCLAIMER_A;
  const cta =
    !isCessation && info.autoChargeUrl
      ? `
      <p style="font-size:14px;line-height:1.5;margin:14px 0 6px">Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico.</p>
      <p style="margin:0 0 4px">
        <a href="${info.autoChargeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva il rinnovo automatico →</a>
      </p>`
      : "";
  return `
    ${bankSectionHtml(amountLabel)}
    <p style="font-size:12px;color:#94a3b8;font-style:italic;line-height:1.6;margin:0">${disclaimer}</p>
    ${cta}`;
}

/** Override testuale (oggetto/corpo) per un reminder; null/undefined = default. */
export type ReminderOverride = {
  subject?: string | null;
  body?: string | null;
};

export type ReminderAudience = "admin" | "client";

/**
 * Genera oggetto + corpo (testo e HTML) per il tipo di notifica indicato.
 *
 * - audience "admin" (default): comportamento invariato — link al dettaglio
 *   dashboard; `override` (da ReminderTemplate) sostituisce oggetto/corpo.
 * - audience "client": tono diretto verso il cliente, NESSUN link interno,
 *   contatto hello@deltasolutions.agency; usa i testi client di default
 *   (gli override di Impostazioni valgono solo per la versione admin).
 */
export function buildReminderEmail(
  type: NotificationType,
  d: ReminderEmailData,
  opts?: {
    override?: ReminderOverride;
    audience?: ReminderAudience;
    clientRenewal?: ClientRenewalInfo;
  },
): EmailContent {
  const audience = opts?.audience ?? "admin";
  const def = REMINDER_DEFAULTS[type as ReminderConfigurableType];

  // Type non gestito (es. CONFERMA_ACQUISTO ha il suo generatore).
  if (!def) {
    const subject = `[Radar] Notifica abbonamento: ${d.clientName} — ${d.serviceName}`;
    return {
      subject,
      text: detailsText(d),
      html: wrapHtml("Notifica abbonamento", "", d),
    };
  }

  // ── Versione CLIENTE ─────────────────────────────────────────────────────
  if (audience === "client") {
    const cdef = REMINDER_CLIENT_DEFAULTS[type as ReminderConfigurableType];
    const subject = fillReminderPlaceholders(cdef.subject, d);
    const intro = fillReminderPlaceholders(cdef.body, d);

    // Sezione rinnovo (coordinate + disclaimer + eventuale CTA): compare SOLO se
    // l'item non ha il rinnovo automatico attivo (clientRenewal valorizzato).
    // Il disclaimer/CTA dipendono dal tipo: cessazione = Caso B (no CTA).
    const renewal = opts?.clientRenewal;
    const isCessation = type === "CESSAZIONE_MOROSITA";
    const renewalTextBlocks = renewal
      ? clientRenewalText(renewal, isCessation)
      : [];
    const renewalHtmlBlock = renewal
      ? clientRenewalHtml(renewal, isCessation)
      : "";

    const text = [
      `Ciao ${d.clientName},`,
      "",
      intro,
      "",
      clientDetailsText(d),
      ...renewalTextBlocks,
      "",
      CONTACT_LINE_TEXT,
    ].join("\n");

    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
        ${emailHeaderHtml()}
        <h2 style="font-size:18px;margin:0 0 8px">${cdef.title}</h2>
        <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName}, ${intro}</p>
        ${clientDetailsHtml(d)}
        ${renewalHtmlBlock}
        <p style="font-size:13px;color:#64748b;line-height:1.5;margin-top:12px">
          ${CONTACT_LINE_TEXT.replace(
            "hello@deltasolutions.agency",
            `<a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>`,
          )}
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
      </div>`;

    return { subject, text, html };
  }

  // ── Versione ADMIN (invariata) ───────────────────────────────────────────
  const override = opts?.override;
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
  endDate: Date; // scadenza del servizio
};

export type WelcomeEmailData = {
  clientName: string;
  /** Servizi attivati con questo primo abbonamento. */
  items: WelcomeEmailItem[];
  /**
   * Se valorizzato (flag "richiedi rinnovo automatico" in creazione), la mail
   * include una sezione dedicata con la spiegazione del rinnovo automatico e la
   * CTA al link pubblico di attivazione (/attiva-rinnovo/{token}).
   */
  autoChargeUrl?: string | null;
  /**
   * Se valorizzati, la mail include la sezione "I tuoi dati di fatturazione"
   * (sola lettura) con la CTA verso /i-tuoi-dati/{token} e il disclaimer.
   */
  dataEditUrl?: string | null;
  billingData?: BillingDatum[];
};

const CONTACT_EMAIL = "hello@deltasolutions.agency";

// ──────────────────────────────────────────────────────────────────────────
// Sezione DATI DI FATTURAZIONE (sola lettura + CTA) — condivisa da benvenuto
// e richiesta di verifica dati. Il disclaimer è identico in entrambe.
// ──────────────────────────────────────────────────────────────────────────

export type BillingDatum = { label: string; value: string };

export const BILLING_DATA_DISCLAIMER =
  "Puoi rivedere questi dati quando vuoi da questo link. Se qualcosa non è corretto, potrai modificarlo una sola volta: dopo il salvataggio, per un'ulteriore modifica dovrai richiedercelo scrivendo a hello@deltasolutions.agency.";

const dashValue = (v: string) => (v.trim() ? v : "—");

/** Blocco dati di fatturazione + CTA + disclaimer, versione testo. */
function billingDataSectionText(
  data: BillingDatum[],
  url: string,
  ctaLabel: string,
): string[] {
  return [
    "",
    "I tuoi dati di fatturazione:",
    ...data.map((d) => `- ${d.label}: ${dashValue(d.value)}`),
    "",
    `${ctaLabel}: ${url}`,
    "",
    BILLING_DATA_DISCLAIMER,
  ];
}

/** Blocco dati di fatturazione + CTA + disclaimer, versione HTML. */
function billingDataSectionHtml(
  data: BillingDatum[],
  url: string,
  ctaLabel: string,
): string {
  const rows = data
    .map(
      (d) => `
        <tr>
          <td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${d.label}</td>
          <td style="padding:4px 0;color:#1e293b">${dashValue(d.value)}</td>
        </tr>`,
    )
    .join("");
  return `
    <div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc">
      <h3 style="font-size:15px;margin:0 0 10px">I tuoi dati di fatturazione</h3>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:14px 0 10px">
        <a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${ctaLabel} →</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">${BILLING_DATA_DISCLAIMER}</p>
    </div>`;
}

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
    const expiry = formatDate(it.endDate);
    return { name, period, price, expiry };
  };

  const itemLinesText = d.items.map((it) => {
    const { name, period, price, expiry } = itemLabel(it);
    return `- ${name} — ${period} — scade il ${expiry} — ${price}`;
  });

  // Sezione rinnovo automatico (solo se richiesto in creazione).
  const autoChargeText = d.autoChargeUrl
    ? [
        "",
        "Rinnovo automatico",
        "Per non pensare più alle scadenze, puoi attivare il rinnovo automatico: registri una carta una sola volta e i servizi indicati verranno rinnovati e addebitati in automatico. Puoi revocarlo quando vuoi.",
        `Attiva ora: ${d.autoChargeUrl}`,
      ]
    : [];

  // Sezione dati di fatturazione (sola lettura) + CTA + disclaimer.
  const dataSectionText =
    d.dataEditUrl && d.billingData
      ? billingDataSectionText(
          d.billingData,
          d.dataEditUrl,
          "Visualizza o correggi i tuoi dati",
        )
      : [];

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    "",
    "Servizi attivati:",
    ...itemLinesText,
    "",
    explanation,
    ...autoChargeText,
    ...dataSectionText,
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
      const { name, period, price, expiry } = itemLabel(it);
      return `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${name}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${period}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap">scade il ${expiry}</td>
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
            <th style="padding:0 12px 6px 0;font-weight:500">Scadenza</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">Prezzo</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <p style="font-size:14px;line-height:1.5">${explanation}</p>
      ${
        d.autoChargeUrl
          ? `<div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc">
        <h3 style="font-size:15px;margin:0 0 6px">Attiva il rinnovo automatico</h3>
        <p style="font-size:14px;line-height:1.5;margin:0 0 12px">Per non pensare più alle scadenze, registra una carta una sola volta: i servizi indicati verranno rinnovati e addebitati in automatico. Puoi revocarlo quando vuoi.</p>
        <a href="${d.autoChargeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva rinnovo automatico →</a>
      </div>`
          : ""
      }
      ${
        d.dataEditUrl && d.billingData
          ? billingDataSectionHtml(
              d.billingData,
              d.dataEditUrl,
              "Visualizza o correggi i tuoi dati",
            )
          : ""
      }
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

export type AutoChargeRequestItem = {
  serviceName: string;
  amountLabel: string;
  periodicityLabel: string;
};

/**
 * Email al cliente con il link per attivare il rinnovo automatico (registrazione
 * carta con gate di consenso) per un INSIEME ESPLICITO di servizi scelti
 * dall'admin. Rivolta al cliente: elenca ESATTAMENTE quei servizi, solo il link
 * pubblico /attiva-rinnovo, mai link interni.
 */
export function buildAutoChargeRequestEmail(d: {
  items: AutoChargeRequestItem[];
  activationUrl: string;
}): EmailContent {
  const label = servicesLabel(d.items.map((it) => ({ serviceName: it.serviceName })));
  const subject = `Radar — Attiva il rinnovo automatico per ${label}`;
  const intro =
    "Puoi attivare il rinnovo automatico registrando una carta: autorizzerai l'addebito ricorrente per i servizi elencati qui sotto, ciascuno alla propria cadenza. Puoi revocare l'autorizzazione in qualsiasi momento scrivendo a hello@deltasolutions.agency.";

  const itemLinesText = d.items.map(
    (it) => `- ${it.serviceName}: ${it.amountLabel} · ${it.periodicityLabel}`,
  );

  const text = [
    intro,
    "",
    "Servizi inclusi:",
    ...itemLinesText,
    "",
    `Attiva ora: ${d.activationUrl}`,
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${it.serviceName}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${it.periodicityLabel}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${it.amountLabel}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Attiva il rinnovo automatico</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">Servizio</th>
            <th style="padding:0 12px 6px 0;font-weight:500">Periodicità</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">Importo</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <p style="margin:20px 0">
        <a href="${d.activationUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva rinnovo automatico →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

/**
 * Sollecito GENTILE al cliente che ha ricevuto una richiesta di attivazione del
 * rinnovo automatico ma non l'ha ancora completata. Ripropone lo stesso link.
 */
export function buildAutoChargeReminderEmail(d: {
  clientName: string;
  activationUrl: string;
}): EmailContent {
  const subject = "Radar — Completa l'attivazione del rinnovo automatico";
  const intro =
    "ti avevamo proposto l'attivazione del rinnovo automatico, ma non risulta ancora completata. Bastano un paio di minuti: registri la carta una sola volta e non dovrai più pensare alle scadenze.";

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    "",
    `Completa l'attivazione: ${d.activationUrl}`,
    "",
    "Se preferisci non attivarlo o hai domande, scrivici a hello@deltasolutions.agency.",
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Completa l'attivazione del rinnovo automatico</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName}, ${intro}</p>
      <p style="margin:20px 0">
        <a href="${d.activationUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Completa l'attivazione →</a>
      </p>
      <p style="font-size:13px;color:#64748b;line-height:1.5">Se preferisci non attivarlo o hai domande, scrivici a <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

/**
 * Escalation all'ADMIN: il cliente non ha completato l'attivazione del rinnovo
 * automatico entro l'ultima soglia. NON auto-agisce: informa soltanto, la
 * decisione (reinviare, contattare, pagamento manuale) resta all'admin.
 */
export function buildAutoChargeNotConfirmedEmail(d: {
  clientName: string;
  requestedAt: Date;
}): EmailContent {
  const subject = `[Radar] Rinnovo automatico non completato: ${d.clientName}`;
  const intro = `Il cliente ${d.clientName} non ha ancora completato l'attivazione del rinnovo automatico richiesta il ${formatDate(d.requestedAt)}. Valuta se reinviare la richiesta, contattarlo direttamente, o procedere con un pagamento manuale.`;

  const text = [intro].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Rinnovo automatico non completato</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · notifica automatica</p>
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
  /** Importo totale rimborsato (righe stornate + quota costo di servizio). */
  totalCents: number;
  /** Quota proporzionale del costo di servizio resa in questo storno (0 se assente). */
  serviceFeeCents?: number;
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

  const serviceFeeCents = d.serviceFeeCents ?? 0;

  const itemLinesText = d.items.map(
    (it) =>
      `- ${it.serviceName}: ${formatEur(it.amountCents, currency)}${
        it.renewalReverted ? " (rinnovo annullato)" : ""
      }`,
  );
  if (serviceFeeCents > 0) {
    itemLinesText.push(
      `- Costi di servizio (quota proporzionale): ${formatEur(
        serviceFeeCents,
        currency,
      )}`,
    );
  }

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

  const serviceFeeRowHtml =
    serviceFeeCents > 0
      ? `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">Costi di servizio <span style="color:#94a3b8;font-size:12px">— quota proporzionale</span></td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(serviceFeeCents, currency)}</td>
        </tr>`
      : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Rimborso effettuato</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName},</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <tbody>${itemRowsHtml}${serviceFeeRowHtml}</tbody>
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

// ──────────────────────────────────────────────────────────────────────────
// NOTIFICA ADMIN — dati di fatturazione modificati dal cliente
// ──────────────────────────────────────────────────────────────────────────

export type ClientDataChangeAdminData = {
  clientName: string;
  clientId: string;
  /** Diff leggibile: per ogni campo modificato, etichetta + valore prima/dopo. */
  changes: { label: string; from: string; to: string }[];
  ipAddress?: string | null;
};

/**
 * Email all'admin che notifica una modifica ai dati di fatturazione effettuata
 * dal cliente tramite la pagina pubblica self-service. Elenca il diff campo per
 * campo (prima → dopo) e l'IP di provenienza.
 */
export function buildClientDataChangeEmail(
  d: ClientDataChangeAdminData,
): EmailContent {
  const base = process.env.APP_URL ?? "";
  const clientUrl = `${base}/clienti/${d.clientId}`;
  const dash = (v: string) => (v.trim() ? v : "—");

  const subject = `[Radar] Dati di fatturazione aggiornati: ${d.clientName}`;

  const changeLinesText = d.changes.map(
    (c) => `- ${c.label}: ${dash(c.from)} -> ${dash(c.to)}`,
  );
  const text = [
    `Il cliente ${d.clientName} ha aggiornato i propri dati di fatturazione.`,
    "",
    "Modifiche:",
    ...changeLinesText,
    "",
    `IP: ${d.ipAddress ?? "sconosciuto"}`,
    `Scheda cliente: ${clientUrl}`,
  ].join("\n");

  const changeRowsHtml = d.changes
    .map(
      (c) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap">${c.label}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#94a3b8;text-decoration:line-through">${dash(c.from)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-weight:600">${dash(c.to)}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Dati di fatturazione aggiornati</h2>
      <p style="font-size:14px;line-height:1.5">Il cliente <strong>${d.clientName}</strong> ha aggiornato i propri dati di fatturazione dalla pagina pubblica.</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <thead>
          <tr>
            <td style="padding:0 12px 6px 0;color:#94a3b8;font-size:12px">Campo</td>
            <td style="padding:0 12px 6px 0;color:#94a3b8;font-size:12px">Prima</td>
            <td style="padding:0 0 6px;color:#94a3b8;font-size:12px">Dopo</td>
          </tr>
        </thead>
        <tbody>${changeRowsHtml}</tbody>
      </table>
      <p style="font-size:13px;color:#64748b">IP di provenienza: ${d.ipAddress ?? "sconosciuto"}</p>
      <p style="margin:16px 0">
        <a href="${clientUrl}" style="color:#4f46e5">Apri la scheda cliente →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · notifica automatica</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// RICHIESTA VERIFICA DATI — email al cliente (bottone admin)
// ──────────────────────────────────────────────────────────────────────────

export type DataUpdateRequestData = {
  clientName: string;
  billingData: BillingDatum[];
  dataEditUrl: string;
};

/**
 * Email al cliente con cui l'admin chiede di verificare/aggiornare i propri dati
 * di fatturazione. Riusa la sezione dati (sola lettura + CTA + disclaimer)
 * condivisa con la mail di benvenuto.
 */
export function buildDataUpdateRequestEmail(
  d: DataUpdateRequestData,
): EmailContent {
  const subject = "Delta Solutions — verifica i tuoi dati di fatturazione";
  const intro =
    "Delta Solutions ti chiede di verificare i tuoi dati di fatturazione: controlla che siano corretti e, se serve, aggiornali dal link qui sotto.";
  const ctaLabel = "Verifica i tuoi dati";

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    ...billingDataSectionText(d.billingData, d.dataEditUrl, ctaLabel),
    "",
    `Per qualsiasi domanda scrivici a ${CONTACT_EMAIL}.`,
    "",
    "Il team di Delta Solutions Agency",
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Verifica i tuoi dati di fatturazione</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${d.clientName},</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${billingDataSectionHtml(d.billingData, d.dataEditUrl, ctaLabel)}
      <p style="font-size:13px;color:#64748b;line-height:1.6">
        Per qualsiasi domanda scrivici a
        <a href="mailto:${CONTACT_EMAIL}" style="color:#4f46e5">${CONTACT_EMAIL}</a>.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions Agency</p>
    </div>`;

  return { subject, text, html };
}
