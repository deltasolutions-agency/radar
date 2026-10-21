import "server-only";
import { NotificationType, type PaymentMethod } from "@prisma/client";
import { formatDate, formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { splitVatFromGross, addVatToNet } from "@/lib/vat";
import { escapeHtml as h } from "@/lib/html-escape";
import { computeServiceFeeCents } from "@/lib/service-fee";

/** Una riga (servizio) di un'email di reminder. */
export type ReminderEmailItem = {
  /** Nome servizio (già comprensivo di "×N" se quantità > 1). */
  serviceName: string;
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
};

/**
 * Dati necessari a comporre le email di reminder/sollecito/cessazione.
 * Un'email copre una o più righe dello stesso abbonamento con la stessa
 * scadenza. clientName/serviceName sono i valori correnti (join live nel cron).
 */
export type ReminderEmailData = {
  subscriptionId: string;
  clientName: string;
  items: ReminderEmailItem[];
  endDate: Date;
  /** Giorni mancanti alla scadenza (negativo se già scaduto). */
  diffDays: number;
};

// ──────────────────────────────────────────────────────────────────────────
// Righe servizio con CLIENTE FINALE — helper condivisi da tutte le email
// ──────────────────────────────────────────────────────────────────────────

/** Riga servizio, versione testo: "Servizio — Cliente finale: X". */
function serviceLineText(name: string, endClientName?: string | null): string {
  return endClientName ? `${name} — Cliente finale: ${endClientName}` : name;
}

/** Cella servizio, versione HTML: nome + cliente finale come sottotitolo. */
function serviceCellHtml(name: string, endClientName?: string | null): string {
  return endClientName
    ? `${h(name)}<br/><span style="font-family:'Space Mono','Courier New',monospace;font-size:12px;color:#64748b">Cliente finale: ${h(endClientName)}</span>`
    : h(name);
}

/** Nomi dei servizi del reminder, separati da virgola ({serviceName}). */
function reminderServiceNames(d: ReminderEmailData): string {
  return d.items.map((it) => it.serviceName).join(", ");
}

/** Cliente finale comune a tutte le righe, altrimenti null. */
function reminderCommonEndClient(d: ReminderEmailData): string | null {
  const first = d.items[0]?.endClientName ?? null;
  if (!first) return null;
  return d.items.every((it) => it.endClientName === first) ? first : null;
}

/** Righe servizio del reminder, versione testo ({serviceLines}). */
function reminderServiceLinesText(d: ReminderEmailData): string {
  return d.items
    .map((it) => `- ${serviceLineText(it.serviceName, it.endClientName)}`)
    .join("\n");
}

/** Aggiunge " – {cliente finale}" all'oggetto se comune a tutte le righe. */
function withEndClientSubject(subject: string, d: ReminderEmailData): string {
  const common = reminderCommonEndClient(d);
  return common ? `${subject} – ${common}` : subject;
}

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function detailUrl(subscriptionId: string): string {
  const base = process.env.APP_URL ?? "";
  return `${base}/abbonamenti/${subscriptionId}`;
}

// Ogni email ha un contenitore con sfondo bianco esplicito: nei client in
// modalità scura che mantengono i colori dell'autore il testo scuro resta su
// fondo chiaro (leggibile); quelli che invertono i colori lo invertono tutto.

/**
 * Header brandizzato condiviso da OGNI email inviata da Radar: logo Delta
 * Solutions + payoff "Radar" (Space Mono con fallback di sistema, dato che i
 * client email non caricano font custom) + separatore leggero.
 *
 * Il logo è servito dal dominio Radar (public/logo-delta-solutions-email.png):
 * le email richiedono un URL assoluto, quindi si usa APP_URL.
 */
function emailHeaderHtml(): string {
  // Versione email del logo: su "pastiglia" bianca integrata nel PNG, così il
  // testo resta leggibile anche nei client in modalità scura (le immagini non
  // vengono invertite). 600×164 px @2x → 161×44 visualizzati.
  const logoUrl = `${process.env.APP_URL ?? ""}/logo-delta-solutions-email.png`;
  return `
    <div style="margin-bottom:16px">
      <img src="${logoUrl}" alt="Delta Solutions" width="161" height="44" style="width:161px;height:44px;display:block;margin-bottom:4px;border:0" />
      <p style="margin:0;font-family:'Space Mono','Courier New',monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#64748b">Radar</p>
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px" />`;
}

/** Blocco dati comune (testo semplice). */
function detailsText(d: ReminderEmailData): string {
  return [
    `Cliente:   ${d.clientName}`,
    d.items.length === 1
      ? `Servizio:  ${serviceLineText(d.items[0].serviceName, d.items[0].endClientName)}`
      : `Servizi:\n${reminderServiceLinesText(d)}`,
    `Scadenza:  ${formatDate(d.endDate)}`,
    `Dettaglio: ${detailUrl(d.subscriptionId)}`,
  ].join("\n");
}

/** Righe "Servizio" della tabella dettagli (una per riga del reminder). */
function reminderServiceRowsHtml(d: ReminderEmailData): string {
  return d.items
    .map(
      (it, i) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;vertical-align:top">${i === 0 ? (d.items.length > 1 ? "Servizi" : "Servizio") : ""}</td><td style="padding:2px 0">${serviceCellHtml(it.serviceName, it.endClientName)}</td></tr>`,
    )
    .join("");
}

/** Blocco dati comune (HTML). */
function detailsHtml(d: ReminderEmailData): string {
  const url = detailUrl(d.subscriptionId);
  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Cliente</td><td>${h(d.clientName)}</td></tr>
      ${reminderServiceRowsHtml(d)}
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Scadenza</td><td>${formatDate(d.endDate)}</td></tr>
    </table>
    <p style="font-family:sans-serif;font-size:14px">
      <a href="${url}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>
    </p>`;
}

function wrapHtml(title: string, intro: string, d: ReminderEmailData): string {
  return `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${title}</h2>
      <p style="font-size:14px;line-height:1.5">${multilineHtml(intro)}</p>
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
 * supportano i segnaposto elencati in REMINDER_PLACEHOLDERS. Usati sia come
 * fallback quando non c'è override, sia come placeholder nel form di Impostazioni.
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

/** Segnaposto disponibili nei template reminder (legenda in Impostazioni). */
export const REMINDER_PLACEHOLDERS: { token: string; description: string }[] = [
  { token: "{clientName}", description: "nome o ragione sociale del cliente" },
  { token: "{serviceName}", description: "servizi, separati da virgola" },
  {
    token: "{serviceLines}",
    description: "elenco servizi, uno per riga, con il cliente finale",
  },
  {
    token: "{endClientName}",
    description:
      "cliente finale, se uguale per tutti i servizi (alias {{cliente_finale}})",
  },
  { token: "{endDate}", description: "data di scadenza" },
  { token: "{diffDays}", description: "giorni mancanti alla scadenza" },
  { token: "{diffDaysAfter}", description: "giorni trascorsi dalla scadenza" },
];

/** Sostituisce i segnaposto {token} con i valori del reminder. */
function fillReminderPlaceholders(tpl: string, d: ReminderEmailData): string {
  const diffDaysAfter = -d.diffDays;
  const endClient = reminderCommonEndClient(d) ?? "";
  return tpl
    .replaceAll("{{cliente_finale}}", endClient)
    .replaceAll("{clientName}", d.clientName)
    .replaceAll("{serviceName}", reminderServiceNames(d))
    .replaceAll("{serviceLines}", reminderServiceLinesText(d))
    .replaceAll("{endClientName}", endClient)
    .replaceAll("{endDate}", formatDate(d.endDate))
    .replaceAll("{diffDays}", String(d.diffDays))
    .replaceAll("{diffDaysAfter}", String(diffDaysAfter));
}

/**
 * Oggetto del reminder: segnaposto risolti + " – {cliente finale}" se comune a
 * tutte le righe (salvo che il template lo includa già esplicitamente).
 */
function reminderSubject(tpl: string, d: ReminderEmailData): string {
  const filled = fillReminderPlaceholders(tpl, d).replaceAll("\n", " ");
  const explicit =
    tpl.includes("{endClientName}") || tpl.includes("{{cliente_finale}}");
  return explicit ? filled : withEndClientSubject(filled, d);
}

/** Testo con a capo → HTML (escape + <br/>), per corpi che includono {serviceLines}. */
function multilineHtml(text: string): string {
  return h(text).replaceAll("\n", "<br/>");
}

/**
 * Testi di DEFAULT rivolti al CLIENTE (destinatario = client.email). Tono diretto
 * verso il cliente, nessun riferimento a "contattare il cliente"/dashboard.
 * Non personalizzabili da Impostazioni (gli override lì valgono per l'admin).
 */
export const REMINDER_CLIENT_DEFAULTS: Record<
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

/**
 * Varianti PLURALI dei testi cliente, usate quando l'email copre più servizi
 * (stesso abbonamento, stessa scadenza). L'elenco dei servizi è nel blocco
 * dettagli, quindi qui non si ripete {serviceName}.
 */
const REMINDER_CLIENT_DEFAULTS_PLURAL: Record<
  ReminderConfigurableType,
  { subject: string; body: string; title: string }
> = {
  PROMEMORIA_30: {
    subject: "I tuoi servizi sono in scadenza il {endDate}",
    body: "ti ricordiamo che i servizi elencati qui sotto scadranno il {endDate} (tra {diffDays} giorni). Per non interromperli, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "I tuoi servizi sono in scadenza",
  },
  PROMEMORIA_15: {
    subject: "I tuoi servizi sono in scadenza il {endDate}",
    body: "ti ricordiamo che i servizi elencati qui sotto scadranno il {endDate} (tra {diffDays} giorni). Per non interromperli, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "I tuoi servizi sono in scadenza",
  },
  PROMEMORIA_7: {
    subject: "I tuoi servizi sono in scadenza il {endDate}",
    body: "ti ricordiamo che i servizi elencati qui sotto scadranno il {endDate} (tra {diffDays} giorni). Per non interromperli, ti invitiamo a provvedere al rinnovo per tempo.",
    title: "I tuoi servizi sono in scadenza",
  },
  SOLLECITO: {
    subject: "I tuoi servizi sono scaduti il {endDate}",
    body: "i servizi elencati qui sotto sono scaduti il {endDate} e non risultano ancora rinnovati. Ti invitiamo a regolarizzare il pagamento al più presto per evitare l'interruzione dei servizi.",
    title: "I tuoi servizi sono scaduti",
  },
  CESSAZIONE_MOROSITA: {
    subject: "I tuoi servizi sono stati cessati",
    body: "ti informiamo che i servizi elencati qui sotto sono stati cessati per mancato rinnovo, trascorsi i giorni previsti dalla scadenza. Se desideri riattivarli, contattaci il prima possibile.",
    title: "I tuoi servizi sono stati cessati",
  },
};

const CONTACT_LINE_TEXT =
  "Per qualsiasi domanda scrivici a hello@deltasolutions.agency.";

/** Blocco dettagli per il CLIENTE (servizi + scadenza, nessun link admin). */
function clientDetailsText(d: ReminderEmailData): string {
  return [
    d.items.length === 1
      ? `Servizio:  ${serviceLineText(d.items[0].serviceName, d.items[0].endClientName)}`
      : `Servizi:\n${reminderServiceLinesText(d)}`,
    `Scadenza:  ${formatDate(d.endDate)}`,
  ].join("\n");
}

function clientDetailsHtml(d: ReminderEmailData): string {
  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
      ${reminderServiceRowsHtml(d)}
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Scadenza</td><td>${formatDate(d.endDate)}</td></tr>
    </table>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Sezione RINNOVO del reminder CLIENTE (righe senza rinnovo automatico):
// pagamento online con carta (blocco principale) + istruzioni per il bonifico
// solo se abilitate in Impostazioni (showBankTransferInstructions).
// ──────────────────────────────────────────────────────────────────────────

// Dati bancari: mostrati solo con l'interruttore attivo in Impostazioni.
const RENEWAL_BANK = {
  beneficiary: "Andrea Trinca",
  iban: "IT40L0366901600715069802019",
  swift: "REVOITM2",
} as const;

const RENEWAL_PRICE_MAY_VARY =
  "Il prezzo dei rinnovi successivi potrebbe variare, in aumento o in diminuzione, rispetto a quello indicato.";
const RENEWAL_PRICE_LOCKED = "Dal rinnovo successivo il prezzo resterà invariato.";

/** Riga coperta dal reminder, per il disclaimer sul periodo e sul prezzo. */
export type RenewalTermsItem = {
  serviceName: string;
  billingPeriod: BillingPeriodValue;
  /** true = aumento "una sola volta" (ONCE): dopo questo rinnovo il prezzo non cambia. */
  priceLocked: boolean;
};

/** "il prossimo anno" / "il prossimo mese" / "il prossimo periodo (di ciascun servizio)". */
function renewalPeriodPhrase(items: RenewalTermsItem[]): string {
  const periods = new Set(items.map((it) => it.billingPeriod));
  if (periods.size > 1) return "il prossimo periodo di ciascun servizio";
  const [p] = [...periods];
  return p === "ANNUALE" ? "il prossimo anno" : p === "MENSILE" ? "il prossimo mese" : "il prossimo periodo";
}

/**
 * Disclaimer sotto il riepilogo (Caso A): periodo reale coperto e, per il
 * prezzo, "potrebbe variare" (EVERY_RENEWAL) o "resterà invariato" (ONCE).
 * Con righe miste: variazione + elenco dei servizi a prezzo bloccato.
 */
function renewalDisclaimerLines(items: RenewalTermsItem[]): string[] {
  const first = `Questo importo si riferisce al rinnovo per ${renewalPeriodPhrase(items)}.`;
  const locked = items.filter((it) => it.priceLocked);
  if (items.length > 0 && locked.length === items.length) {
    return [first, RENEWAL_PRICE_LOCKED];
  }
  if (locked.length === 0) return [`${first} ${RENEWAL_PRICE_MAY_VARY}`];
  return [
    `${first} ${RENEWAL_PRICE_MAY_VARY}`,
    `${locked.map((it) => it.serviceName).join(", ")}: ${RENEWAL_PRICE_LOCKED.charAt(0).toLowerCase()}${RENEWAL_PRICE_LOCKED.slice(1)}`,
  ];
}

const RENEWAL_DISCLAIMER_CESSATION =
  "Il tuo servizio è stato sospeso per mancato rinnovo. Effettuando il pagamento del rinnovo, faremo il possibile per riattivarlo; se la riattivazione non fosse possibile, valuteremo un rimborso. In alcuni casi potrebbero essere necessari ulteriori accordi economici per il ripristino del servizio. Ti invitiamo a contattarci a hello@deltasolutions.agency prima di procedere al pagamento, per verificare la situazione specifica del tuo servizio.";

/**
 * Dati per la sezione rinnovo del reminder CLIENTE. La presenza di questo
 * oggetto indica che le righe NON hanno il rinnovo automatico attivo: va
 * mostrato il pagamento online (link /pay) con il riepilogo importi.
 * `autoChargeUrl` è valorizzato solo nel Caso A (promemoria/sollecito) per la
 * CTA di attivazione; assente per la cessazione (Caso B).
 */
export type ClientRenewalInfo = {
  /**
   * Netto (prezzo del prossimo rinnovo × quantità) di CIASCUNA riga. IVA e
   * lordo sono calcolati per riga con addVatToNet e sommati, il costo di
   * servizio con computeServiceFeeCents sul lordo — come il checkout Stripe,
   * così il riepilogo coincide con la pagina /pay.
   */
  itemNetCents: number[];
  currency: string;
  /** Subscription.serviceFeeEnabled: commissione 1,5% sui pagamenti con carta. */
  serviceFeeEnabled: boolean;
  /** Link di pagamento online (/pay/{payToken}). */
  payUrl: string | null;
  autoChargeUrl?: string | null;
  /** Istruzioni per il bonifico come alternativa (Impostazioni, default no). */
  showBankTransfer?: boolean;
  /** Righe coperte: periodo reale e modalità prezzo per il disclaimer. */
  terms: RenewalTermsItem[];
};

/** Somma per riga di netto/IVA/lordo (addVatToNet su ciascuna riga). */
function sumVatPerItem(itemNetCents: number[]): {
  netCents: number;
  vatCents: number;
  grossCents: number;
} {
  return itemNetCents.reduce(
    (acc, net) => {
      const r = addVatToNet(net);
      return {
        netCents: acc.netCents + r.netCents,
        vatCents: acc.vatCents + r.vatCents,
        grossCents: acc.grossCents + r.grossCents,
      };
    },
    { netCents: 0, vatCents: 0, grossCents: 0 },
  );
}

/** Riepilogo del pagamento con carta (stessi importi di /pay e del checkout). */
export function cardPaymentSummary(info: Pick<ClientRenewalInfo, "itemNetCents" | "serviceFeeEnabled">) {
  const { netCents, vatCents, grossCents } = sumVatPerItem(info.itemNetCents);
  const serviceFeeCents = computeServiceFeeCents(grossCents, info.serviceFeeEnabled);
  return { netCents, vatCents, grossCents, serviceFeeCents, totalCents: grossCents + serviceFeeCents };
}

/**
 * Nelle email con link di pagamento si mostra solo l'imponibile: IVA,
 * commissione e totale con carta compaiono sulla pagina /pay, prima di Stripe.
 */
const NET_ONLY_LABEL = "Imponibile (IVA esclusa)";
const NET_ONLY_NOTE =
  "IVA e commissione di servizio sono indicate nella pagina di pagamento.";

/** Coordinate bancarie (alternativa), versione testo. */
function bankSectionText(itemNetCents: number[], currency: string): string {
  const { netCents, vatCents, grossCents } = sumVatPerItem(itemNetCents);
  return [
    "In alternativa, puoi pagare con bonifico:",
    `- Intestatario: ${RENEWAL_BANK.beneficiary}`,
    `- IBAN: ${RENEWAL_BANK.iban}`,
    `- SWIFT (o BIC): ${RENEWAL_BANK.swift}`,
    `- Imponibile: ${formatEur(netCents, currency)}`,
    `- IVA (22%): ${formatEur(vatCents, currency)}`,
    `- Totale da bonificare (senza commissione): ${formatEur(grossCents, currency)}`,
  ].join("\n");
}

/** Coordinate bancarie (alternativa), versione HTML. */
function bankSectionHtml(itemNetCents: number[], currency: string): string {
  const { netCents, vatCents, grossCents } = sumVatPerItem(itemNetCents);
  const mono = "font-family:'Space Mono','Courier New',monospace";
  return `
    <div style="margin:16px 0;border:1px solid #E2DED6;border-radius:8px;padding:12px 16px">
      <p style="font-size:13px;font-weight:600;margin:0 0 6px;color:#4A463F">In alternativa, puoi pagare con bonifico</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;color:#4A463F">
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">Intestatario</td><td>${RENEWAL_BANK.beneficiary}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">IBAN</td><td><span style="${mono}">${RENEWAL_BANK.iban}</span></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">SWIFT (o BIC)</td><td><span style="${mono}">${RENEWAL_BANK.swift}</span></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">Imponibile</td><td><span style="${mono}">${formatEur(netCents, currency)}</span></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">IVA (22%)</td><td><span style="${mono}">${formatEur(vatCents, currency)}</span></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#94a3b8">Totale</td><td><span style="${mono}">${formatEur(grossCents, currency)}</span> <span style="color:#94a3b8">(senza commissione)</span></td></tr>
      </table>
    </div>`;
}

/** Blocchi testo (pagamento online + eventuale bonifico + disclaimer + CTA). */
function clientRenewalText(info: ClientRenewalInfo, isCessation: boolean): string[] {
  const p = cardPaymentSummary(info);
  const c = info.currency;
  const blocks: string[] = [];
  if (info.payUrl) {
    blocks.push(
      "",
      "Paga online con carta:",
      `${NET_ONLY_LABEL}: ${formatEur(p.netCents, c)}`,
      NET_ONLY_NOTE,
      "",
      `Paga online: ${info.payUrl}`,
    );
  }
  if (info.showBankTransfer) blocks.push("", bankSectionText(info.itemNetCents, c));
  if (isCessation) blocks.push("", RENEWAL_DISCLAIMER_CESSATION);
  else for (const line of renewalDisclaimerLines(info.terms)) blocks.push("", line);
  if (!isCessation && info.autoChargeUrl) {
    blocks.push(
      "",
      `Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico: ${info.autoChargeUrl}`,
    );
  }
  return blocks;
}

/** Blocco HTML (pagamento online + eventuale bonifico + disclaimer + CTA). */
function clientRenewalHtml(info: ClientRenewalInfo, isCessation: boolean): string {
  const p = cardPaymentSummary(info);
  const c = info.currency;
  const mono = "font-family:'Space Mono','Courier New',monospace";
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:3px 0;color:${strong ? "#12161F" : "#64748b"};${strong ? "font-weight:700;border-top:1px solid #E2DED6;padding-top:8px" : ""}">${label}</td><td style="padding:3px 0;text-align:right;${mono};${strong ? "font-weight:700;color:#12161F;border-top:1px solid #E2DED6;padding-top:8px" : ""}">${value}</td></tr>`;
  const payBlock = info.payUrl
    ? `
    <div style="margin:16px 0;border:1px solid #E2DED6;border-left:4px solid #2B7FFF;border-radius:8px;background:#FAFAFA;padding:14px 16px">
      <p style="font-size:14px;font-weight:600;margin:0 0 8px;color:#12161F">Paga online con carta</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#4A463F">
        ${row(NET_ONLY_LABEL, formatEur(p.netCents, c), true)}
      </table>
      <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">${NET_ONLY_NOTE}</p>
      <p style="margin:14px 0 0">
        <a href="${h(info.payUrl)}" style="display:inline-block;background:#2B7FFF;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Paga online →</a>
      </p>
    </div>`
    : "";
  const disclaimer = (
    isCessation ? [RENEWAL_DISCLAIMER_CESSATION] : renewalDisclaimerLines(info.terms)
  )
    .map((l) => h(l))
    .join("<br/>");
  const cta =
    !isCessation && info.autoChargeUrl
      ? `
      <p style="font-size:14px;line-height:1.5;margin:14px 0 6px">Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico.</p>
      <p style="margin:0 0 4px">
        <a href="${h(info.autoChargeUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva il rinnovo automatico →</a>
      </p>`
      : "";
  return `
    ${payBlock}
    ${info.showBankTransfer ? bankSectionHtml(info.itemNetCents, c) : ""}
    <p style="font-size:12px;color:#94a3b8;font-style:italic;line-height:1.6;margin:14px 0 0">${disclaimer}</p>
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
 *   contatto hello@deltasolutions.agency; `override` (testi personalizzati da
 *   Impostazioni) sostituisce oggetto/corpo, altrimenti i testi client di
 *   default (singolare o plurale in base al numero di servizi).
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
    const subject = withEndClientSubject(
      `[Radar] Notifica abbonamento: ${d.clientName} — ${reminderServiceNames(d)}`,
      d,
    );
    return {
      subject,
      text: detailsText(d),
      html: wrapHtml("Notifica abbonamento", "", d),
    };
  }

  // ── Versione CLIENTE ─────────────────────────────────────────────────────
  if (audience === "client") {
    const cdef = (
      d.items.length > 1
        ? REMINDER_CLIENT_DEFAULTS_PLURAL
        : REMINDER_CLIENT_DEFAULTS
    )[type as ReminderConfigurableType];
    // Testi personalizzati da Impostazioni (se presenti) al posto dei default.
    const override = opts?.override;
    const subject = reminderSubject(
      override?.subject?.trim() ? override.subject : cdef.subject,
      d,
    );
    const intro = fillReminderPlaceholders(
      override?.body?.trim() ? override.body : cdef.body,
      d,
    );

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
      <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
        ${emailHeaderHtml()}
        <h2 style="font-size:18px;margin:0 0 8px">${cdef.title}</h2>
        <p style="font-size:14px;line-height:1.5">Ciao ${h(d.clientName)}, ${multilineHtml(intro)}</p>
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

  // ── Versione ADMIN ───────────────────────────────────────────────────────
  const override = opts?.override;
  const subjectTpl = override?.subject?.trim() ? override.subject : def.subject;
  const bodyTpl = override?.body?.trim() ? override.body : def.body;

  const subject = reminderSubject(subjectTpl, d);
  const intro = fillReminderPlaceholders(bodyTpl, d);
  const text = `${intro}\n\n${detailsText(d)}`;

  return { subject, text, html: wrapHtml(def.title, intro, d) };
}

// ──────────────────────────────────────────────────────────────────────────
// CONFERMA_ACQUISTO — email di conferma pagamento
// ──────────────────────────────────────────────────────────────────────────

export type ConfirmationEmailItem = {
  serviceName: string;
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
  amountCents: number;
  /** Nuova scadenza dopo il rinnovo (o scadenza corrente se il rinnovo è saltato). */
  newEndDate: Date;
};

export type ConfirmationEmailData = {
  subscriptionId: string;
  clientName: string;
  /** Una voce per ciascun servizio pagato in questo pagamento. */
  items: ConfirmationEmailItem[];
  /** Totale del pagamento (lordo servizi + eventuale costo di servizio). */
  totalCents: number;
  /** Imponibile servizi (netto). Se assente, viene scorporato dal totale. */
  taxableCents?: number;
  /** IVA 22% sui servizi. Se assente, viene scorporata dal totale. */
  vatCents?: number;
  /** Costo di servizio (Stripe), senza IVA propria; mostrato a parte se > 0. */
  serviceFeeCents?: number;
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
  // Imponibile/IVA presi dalla ricevuta (base IVA = solo servizi, il costo di
  // servizio NON concorre); fallback allo scorporo dal totale solo se non
  // forniti (retro-compatibilità).
  const fallback = splitVatFromGross(d.totalCents);
  const taxableCents = d.taxableCents ?? fallback.taxableCents;
  const vatCents = d.vatCents ?? fallback.vatCents;
  const feeCents = d.serviceFeeCents ?? 0;
  const vatLine =
    `di cui imponibile ${formatEur(taxableCents, currency)} + IVA 22% ${formatEur(vatCents, currency)}` +
    (feeCents > 0 ? ` + costi di servizio ${formatEur(feeCents, currency)}` : "");
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
      `- ${serviceLineText(it.serviceName, it.endClientName)}: ${formatEur(it.amountCents, currency)} · nuova scadenza ${formatDate(it.newEndDate)}`,
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
    : `<p style="font-family:sans-serif;font-size:14px;margin:0 0 8px"><span style="color:#64748b">Cliente:</span> ${h(d.clientName)}</p>`;

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;color:#64748b">${formatDate(it.newEndDate)}</td>
        </tr>`,
    )
    .join("");

  const receiptLinkHtml = receiptUrl
    ? `<a href="${h(receiptUrl)}" style="color:#4f46e5">Visualizza la ricevuta →</a><br/>`
    : `<span style="color:#64748b">Ricevuta in generazione, disponibile a breve.</span><br/>`;

  const detailLinkHtml = detail
    ? `<a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>`
    : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
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
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
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
          <td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${h(d.label)}</td>
          <td style="padding:4px 0;color:#1e293b">${h(dashValue(d.value))}</td>
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
        <a href="${h(url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${ctaLabel} →</a>
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
    return `- ${serviceLineText(name, it.endClientName)} — ${period} — scade il ${expiry} — ${price}*`;
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
    "* Prezzi IVA esclusa.",
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
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(name, it.endClientName)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${h(period)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap">scade il ${expiry}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${price}*</td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Benvenuto in Delta Solutions Agency</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${h(d.clientName)},</p>
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
      <p style="font-size:11px;color:#94a3b8;margin:0 0 12px">* Prezzi IVA esclusa.</p>
      <p style="font-size:14px;line-height:1.5">${explanation}</p>
      ${
        d.autoChargeUrl
          ? `<div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc">
        <h3 style="font-size:15px;margin:0 0 6px">Attiva il rinnovo automatico</h3>
        <p style="font-size:14px;line-height:1.5;margin:0 0 12px">Per non pensare più alle scadenze, registra una carta una sola volta: i servizi indicati verranno rinnovati e addebitati in automatico. Puoi revocarlo quando vuoi.</p>
        <a href="${h(d.autoChargeUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva rinnovo automatico →</a>
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
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
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
    (it) =>
      `- ${serviceLineText(it.serviceName, it.endClientName)}: ${it.amountLabel}* · ${it.periodicityLabel}`,
  );

  const text = [
    intro,
    "",
    "Servizi inclusi:",
    ...itemLinesText,
    "* Prezzi IVA esclusa.",
    "",
    `Attiva ora: ${d.activationUrl}`,
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${h(it.periodicityLabel)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${h(it.amountLabel)}*</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
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
      <p style="font-size:11px;color:#94a3b8;margin:0">* Prezzi IVA esclusa.</p>
      <p style="margin:20px 0">
        <a href="${h(d.activationUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Attiva rinnovo automatico →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

/** Una richiesta di attivazione rinnovo automatico (link + servizi coperti). */
export type ActivationRequestInfo = {
  activationUrl: string;
  requestedAt: Date;
  items: { serviceName: string; endClientName?: string | null }[];
};

/** Elenco servizi di una richiesta, testo. */
function activationItemsText(r: ActivationRequestInfo): string[] {
  return r.items.map((it) => `  - ${serviceLineText(it.serviceName, it.endClientName)}`);
}

/** Elenco servizi di una richiesta, HTML. */
function activationItemsHtml(r: ActivationRequestInfo): string {
  if (r.items.length === 0) return "";
  return `<ul style="font-size:14px;padding-left:18px;margin:6px 0">${r.items
    .map((it) => `<li style="margin-bottom:4px">${serviceCellHtml(it.serviceName, it.endClientName)}</li>`)
    .join("")}</ul>`;
}

/**
 * Sollecito GENTILE al cliente che ha ricevuto una o più richieste di
 * attivazione del rinnovo automatico ma non le ha ancora completate. Un'unica
 * email per cliente: ripropone il link di ciascuna richiesta con i servizi.
 */
export function buildAutoChargeReminderEmail(d: {
  clientName: string;
  requests: ActivationRequestInfo[];
}): EmailContent {
  const subject = "Radar — Completa l'attivazione del rinnovo automatico";
  const intro =
    "ti avevamo proposto l'attivazione del rinnovo automatico, ma non risulta ancora completata. Bastano un paio di minuti: registri la carta una sola volta e non dovrai più pensare alle scadenze.";
  const single = d.requests.length === 1;

  const text = [
    `Ciao ${d.clientName},`,
    "",
    intro,
    ...d.requests.flatMap((r) => [
      "",
      ...(r.items.length > 0 ? ["Servizi:", ...activationItemsText(r)] : []),
      `Completa l'attivazione: ${r.activationUrl}`,
    ]),
    "",
    "Se preferisci non attivarlo o hai domande, scrivici a hello@deltasolutions.agency.",
  ].join("\n");

  const requestsHtml = d.requests
    .map(
      (r) => `
      <div style="margin:16px 0;${single ? "" : "border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px"}">
        ${activationItemsHtml(r)}
        <p style="margin:12px 0 0">
          <a href="${h(r.activationUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Completa l'attivazione →</a>
        </p>
      </div>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Completa l'attivazione del rinnovo automatico</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${h(d.clientName)}, ${h(intro)}</p>
      ${requestsHtml}
      <p style="font-size:13px;color:#64748b;line-height:1.5">Se preferisci non attivarlo o hai domande, scrivici a <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

/**
 * Escalation all'ADMIN: il cliente non ha completato l'attivazione del rinnovo
 * automatico entro l'ultima soglia. Un'unica email per cliente con tutte le
 * richieste. NON auto-agisce: la decisione resta all'admin.
 */
export function buildAutoChargeNotConfirmedEmail(d: {
  clientName: string;
  requests: ActivationRequestInfo[];
}): EmailContent {
  const subject = `[Radar] Rinnovo automatico non completato: ${d.clientName}`;
  const dates = [...new Set(d.requests.map((r) => formatDate(r.requestedAt)))].join(", ");
  const intro = `Il cliente ${d.clientName} non ha ancora completato l'attivazione del rinnovo automatico richiesta il ${dates}. Valuta se reinviare la richiesta, contattarlo direttamente, o procedere con un pagamento manuale.`;

  const text = [
    intro,
    ...d.requests.flatMap((r) =>
      r.items.length > 0
        ? ["", `Richiesta del ${formatDate(r.requestedAt)}:`, ...activationItemsText(r)]
        : [],
    ),
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Rinnovo automatico non completato</h2>
      <p style="font-size:14px;line-height:1.5">${h(intro)}</p>
      ${d.requests
        .map((r) =>
          r.items.length > 0
            ? `<p style="font-size:13px;color:#64748b;margin:12px 0 0">Richiesta del ${formatDate(r.requestedAt)}:</p>${activationItemsHtml(r)}`
            : "",
        )
        .join("")}
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
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
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
      `- ${serviceLineText(it.serviceName, it.endClientName)}: ${formatEur(it.amountCents, currency)}${
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
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName)}${
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
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Rimborso effettuato</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${h(d.clientName)},</p>
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
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
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
      return `- ${serviceLineText(it.serviceName, it.endClientName)}${r ? ` — ${r}` : ""}`;
    }),
    "",
    `Dettaglio: ${detail}`,
  ].join("\n");

  const itemsHtml = d.items
    .map((it) => {
      const r = reasonOf(it);
      return `<li style="margin-bottom:2px">${serviceCellHtml(it.serviceName, it.endClientName)}${r ? ` <span style="color:#94a3b8">— ${h(r)}</span>` : ""}</li>`;
    })
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Addebito automatico fallito</h2>
      <p style="font-size:14px;line-height:1.5">${h(intro)}</p>
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
  /** Cliente finale della riga (facoltativo). */
  endClientName?: string | null;
  amountCents: number;
  /** Fine del periodo coperto da questa riga (opzionale). */
  periodEnd?: Date | null;
};

export type PaymentLinkEmailData = {
  /** Una voce per ciascun servizio incluso nel link di pagamento. */
  items: PaymentLinkEmailItem[];
  currency?: string;
  /** URL della pagina di pagamento (gate consenso) o Checkout reale. */
  checkoutUrl: string;
};

/** Il link /pay rigenera la sessione Stripe al click: resta valido fino al pagamento. */
const PAYMENT_LINK_VALIDITY_NOTE = "Il link resta valido fino al pagamento.";

/**
 * Email al cliente con il link di pagamento Stripe. Rivolta al cliente:
 * elenca i servizi inclusi con il prezzo NETTO (IVA esclusa), l'imponibile
 * complessivo e il pulsante "Paga ora". IVA, commissione e totale sono mostrati sulla pagina
 * /pay dopo il click. Contiene SOLO il link di pagamento, mai link interni.
 */
export function buildPaymentLinkEmail(d: PaymentLinkEmailData): EmailContent {
  const currency = d.currency ?? "eur";
  const label = servicesLabel(d.items);
  const netTotal = formatEur(
    d.items.reduce((sum, it) => sum + it.amountCents, 0),
    currency,
  );

  const subject = `Radar — Link di pagamento: ${label}`;
  const intro =
    "Puoi completare il pagamento del tuo abbonamento tramite il link sicuro qui sotto.";

  const itemLinesText = d.items.map((it) => {
    const per = it.periodEnd ? ` (fino al ${formatDate(it.periodEnd)})` : "";
    return `- ${serviceLineText(it.serviceName, it.endClientName)}: ${formatEur(it.amountCents, currency)}*${per}`;
  });

  const text = [
    intro,
    "",
    "Servizi:",
    ...itemLinesText,
    "* Prezzi IVA esclusa.",
    "",
    `${NET_ONLY_LABEL}: ${netTotal}`,
    NET_ONLY_NOTE,
    "",
    `Paga ora: ${d.checkoutUrl}`,
    "",
    PAYMENT_LINK_VALIDITY_NOTE,
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName)}${it.periodEnd ? `<br/><span style="color:#94a3b8;font-size:12px">fino al ${formatDate(it.periodEnd)}</span>` : ""}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency)}*</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Link di pagamento</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">${NET_ONLY_LABEL}</td>
            <td style="padding:8px 0 0;text-align:right;white-space:nowrap;font-weight:600">${netTotal}</td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0 0">* Prezzi IVA esclusa.</p>
      <p style="font-size:12px;color:#94a3b8;margin:4px 0 0">${NET_ONLY_NOTE}</p>
      <p style="margin:20px 0">
        <a href="${h(d.checkoutUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Paga ora →</a>
      </p>
      <p style="font-size:12px;color:#64748b">${PAYMENT_LINK_VALIDITY_NOTE}</p>
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
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap">${h(c.label)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#94a3b8;text-decoration:line-through">${h(dash(c.from))}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-weight:600">${h(dash(c.to))}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Dati di fatturazione aggiornati</h2>
      <p style="font-size:14px;line-height:1.5">Il cliente <strong>${h(d.clientName)}</strong> ha aggiornato i propri dati di fatturazione dalla pagina pubblica.</p>
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
      <p style="font-size:13px;color:#64748b">IP di provenienza: ${h(d.ipAddress ?? "sconosciuto")}</p>
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
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Verifica i tuoi dati di fatturazione</h2>
      <p style="font-size:14px;line-height:1.5">Ciao ${h(d.clientName)},</p>
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

// ──────────────────────────────────────────────────────────────────────────
// PREAVVISO ADDEBITO AUTOMATICO — email al cliente (7 giorni prima)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Email al cliente inviata 7 giorni ESATTI prima dell'addebito automatico di un
 * servizio con rinnovo automatico attivo. Mostra il breakdown IVA + eventuale
 * costo di servizio con le stesse quattro voci usate altrove; gli importi sono
 * precalcolati dal cron con addVatToNet + computeServiceFeeCents, così da
 * coincidere ESATTAMENTE con quanto il cron auto-charge addebiterà quel giorno.
 */
export function buildAutoChargeUpcomingEmail(d: {
  /** Righe con rinnovo automatico che verranno addebitate insieme. */
  items: { serviceName: string; endClientName?: string | null }[];
  endDate: Date;
  netCents: number;
  vatCents: number;
  /** Costo di servizio 1,5% (0 = riga omessa, ovvero serviceFeeEnabled false). */
  serviceFeeCents: number;
  totalCents: number;
  currency?: string;
}): EmailContent {
  const currency = d.currency ?? "eur";
  const dateStr = formatDate(d.endDate);

  const subject = `Radar — Prossimo addebito automatico: ${servicesLabel(d.items)}`;
  const intro =
    d.items.length === 1
      ? `Il ${dateStr} verrà addebitato automaticamente sulla carta registrata per il rinnovo di ${d.items[0].serviceName}.`
      : `Il ${dateStr} verrà addebitato automaticamente sulla carta registrata per il rinnovo dei servizi elencati qui sotto.`;
  const showLines = d.items.length > 1 || d.items.some((it) => it.endClientName);
  const serviceLinesText = showLines
    ? [
        "",
        "Servizi:",
        ...d.items.map((it) => `- ${serviceLineText(it.serviceName, it.endClientName)}`),
      ]
    : [];
  const serviceRowsHtml = showLines
    ? `<ul style="font-family:sans-serif;font-size:14px;color:#1e293b;padding-left:18px;margin:8px 0">${d.items
        .map((it) => `<li style="margin-bottom:4px">${serviceCellHtml(it.serviceName, it.endClientName)}</li>`)
        .join("")}</ul>`
    : "";

  const feeTextLine =
    d.serviceFeeCents > 0
      ? [`Costi di servizio (1,5%): ${formatEur(d.serviceFeeCents, currency)}`]
      : [];
  const text = [
    intro,
    ...serviceLinesText,
    "",
    `Imponibile: ${formatEur(d.netCents, currency)}`,
    `IVA (22%): ${formatEur(d.vatCents, currency)}`,
    ...feeTextLine,
    `Totale addebitato: ${formatEur(d.totalCents, currency)}`,
    "",
    "Se vuoi disattivare il rinnovo automatico, scrivici a hello@deltasolutions.agency.",
  ].join("\n");

  const feeRowHtml =
    d.serviceFeeCents > 0
      ? `<tr><td style="padding:2px 0;color:#64748b">Costi di servizio (1,5%)</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${formatEur(d.serviceFeeCents, currency)}</td></tr>`
      : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Prossimo addebito automatico</h2>
      <p style="font-size:14px;line-height:1.5">${h(intro)}</p>
      ${serviceRowsHtml}
      <div style="margin:16px 0;border:1px solid #E2DED6;border-left:4px solid #2B7FFF;border-radius:8px;background:#FAFAFA;padding:14px 16px">
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#4A463F">
          <tr><td style="padding:2px 0;color:#64748b">Imponibile</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${formatEur(d.netCents, currency)}</td></tr>
          <tr><td style="padding:2px 0;color:#64748b">IVA (22%)</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${formatEur(d.vatCents, currency)}</td></tr>
          ${feeRowHtml}
          <tr><td style="border-top:1px solid #E2DED6;padding:8px 0 0;font-weight:700;color:#12161F">Totale addebitato</td><td style="border-top:1px solid #E2DED6;padding:8px 0 0;text-align:right;font-weight:700;color:#12161F;font-family:'Space Mono','Courier New',monospace">${formatEur(d.totalCents, currency)}</td></tr>
        </table>
      </div>
      <p style="font-size:13px;color:#64748b;line-height:1.6">Se vuoi disattivare il rinnovo automatico, scrivici a <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────────────
// RIEPILOGO ESECUZIONE CRON — email all'admin (una per esecuzione)
// ──────────────────────────────────────────────────────────────────────────

export type CronSummarySection = {
  heading: string;
  /** Righe di testo semplice (vengono escapate nell'HTML). */
  lines: string[];
};

/** Riepilogo di un'esecuzione cron: sezioni con elenchi di righe. */
export function buildCronSummaryEmail(d: {
  subject: string;
  title: string;
  intro: string;
  sections: CronSummarySection[];
}): EmailContent {
  const sections = d.sections.filter((s) => s.lines.length > 0);
  const text = [
    d.intro,
    ...sections.flatMap((s) => ["", `${s.heading}:`, ...s.lines.map((l) => `- ${l}`)]),
  ].join("\n");
  const html = `
    <div style="max-width:640px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${h(d.title)}</h2>
      <p style="font-size:14px;line-height:1.5">${h(d.intro)}</p>
      ${sections
        .map(
          (s) => `
      <h3 style="font-size:14px;margin:18px 0 6px">${h(s.heading)}</h3>
      <ul style="font-size:13px;line-height:1.5;padding-left:18px;margin:0">
        ${s.lines.map((l) => `<li style="margin-bottom:3px">${h(l)}</li>`).join("")}
      </ul>`,
        )
        .join("")}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions · riepilogo automatico</p>
    </div>`;
  return { subject: d.subject, text, html };
}
