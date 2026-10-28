import "server-only";
import { NotificationType, type PaymentMethod } from "@prisma/client";
import { formatDate, formatEur } from "@/lib/format";
import { formatBillingPeriod, type BillingPeriodValue } from "@/lib/validations";
import { splitVatFromGross, addVatToNet } from "@/lib/vat";
import { escapeHtml as h } from "@/lib/html-escape";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { tr, type Lang } from "@/lib/i18n";

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

/** Etichetta "Cliente finale" nella lingua indicata. */
function endClientLabel(lang: Lang): string {
  return tr(lang, { it: "Cliente finale", en: "End client" });
}

/** Riga servizio, versione testo: "Servizio — Cliente finale: X". */
function serviceLineText(
  name: string,
  endClientName?: string | null,
  lang: Lang = "it",
): string {
  return endClientName ? `${name} — ${endClientLabel(lang)}: ${endClientName}` : name;
}

/** Cella servizio, versione HTML: nome + cliente finale come sottotitolo. */
function serviceCellHtml(
  name: string,
  endClientName?: string | null,
  lang: Lang = "it",
): string {
  return endClientName
    ? `${h(name)}<br/><span style="font-family:'Space Mono','Courier New',monospace;font-size:12px;color:#64748b">${endClientLabel(lang)}: ${h(endClientName)}</span>`
    : h(name);
}

/** "Per qualsiasi domanda scrivici a …" (testo, senza link). */
function contactLineText(lang: Lang): string {
  return tr(lang, {
    it: "Per qualsiasi domanda scrivici a hello@deltasolutions.agency.",
    en: "If you have any questions, write to us at hello@deltasolutions.agency.",
  });
}

/** "Per qualsiasi domanda scrivici a <mailto>." (HTML, su una riga). */
function contactMailtoHtml(lang: Lang): string {
  return `${tr(lang, { it: "Per qualsiasi domanda scrivici a", en: "If you have any questions, write to us at" })} <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.`;
}

/** Paragrafo finale "Per qualsiasi domanda…" (HTML multilinea delle email cliente). */
function contactFooterHtml(lang: Lang): string {
  return `<p style="font-size:13px;color:#64748b;line-height:1.6">
        ${tr(lang, { it: "Per qualsiasi domanda scrivici a", en: "If you have any questions, write to us at" })}
        <a href="mailto:${CONTACT_EMAIL}" style="color:#4f46e5">${CONTACT_EMAIL}</a>.
      </p>`;
}

/** Firma testuale delle email cliente. */
function teamSignature(lang: Lang): string {
  return tr(lang, {
    it: "Il team di Delta Solutions Agency",
    en: "The Delta Solutions Agency team",
  });
}

/** Saluto iniziale "Ciao {name}," (testo, non escapato). */
function helloText(name: string, lang: Lang): string {
  return tr(lang, { it: `Ciao ${name},`, en: `Hi ${name},` });
}

/** Nota "* Prezzi IVA esclusa." */
function pricesExclVatNote(lang: Lang): string {
  return tr(lang, { it: "* Prezzi IVA esclusa.", en: "* Prices exclude VAT." });
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
function reminderServiceLinesText(d: ReminderEmailData, lang: Lang = "it"): string {
  return d.items
    .map((it) => `- ${serviceLineText(it.serviceName, it.endClientName, lang)}`)
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
function reminderServiceRowsHtml(d: ReminderEmailData, lang: Lang = "it"): string {
  const heading =
    d.items.length > 1
      ? tr(lang, { it: "Servizi", en: "Services" })
      : tr(lang, { it: "Servizio", en: "Service" });
  return d.items
    .map(
      (it, i) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;vertical-align:top">${i === 0 ? heading : ""}</td><td style="padding:2px 0">${serviceCellHtml(it.serviceName, it.endClientName, lang)}</td></tr>`,
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

/**
 * Legenda dei segnaposto in inglese (stessi token): mostrata in Impostazioni
 * quando si modificano i testi per i clienti in inglese.
 */
export const REMINDER_PLACEHOLDERS_EN: { token: string; description: string }[] = [
  { token: "{clientName}", description: "client name or company name" },
  { token: "{serviceName}", description: "services, comma-separated" },
  {
    token: "{serviceLines}",
    description: "list of services, one per line, with the end client",
  },
  {
    token: "{endClientName}",
    description: "end client, if the same for all services (alias {{cliente_finale}})",
  },
  { token: "{endDate}", description: "expiry date (formatted in English)" },
  { token: "{diffDays}", description: "days left until expiry" },
  { token: "{diffDaysAfter}", description: "days since expiry" },
];

/** Legende dei segnaposto per lingua. */
export const REMINDER_PLACEHOLDERS_BY_LANG: Record<
  Lang,
  { token: string; description: string }[]
> = {
  it: REMINDER_PLACEHOLDERS,
  en: REMINDER_PLACEHOLDERS_EN,
};

/** Sostituisce i segnaposto {token} con i valori del reminder. */
function fillReminderPlaceholders(
  tpl: string,
  d: ReminderEmailData,
  lang: Lang = "it",
): string {
  const diffDaysAfter = -d.diffDays;
  const endClient = reminderCommonEndClient(d) ?? "";
  return tpl
    .replaceAll("{{cliente_finale}}", endClient)
    .replaceAll("{clientName}", d.clientName)
    .replaceAll("{serviceName}", reminderServiceNames(d))
    .replaceAll("{serviceLines}", reminderServiceLinesText(d, lang))
    .replaceAll("{endClientName}", endClient)
    .replaceAll("{endDate}", formatDate(d.endDate, lang))
    .replaceAll("{diffDays}", String(d.diffDays))
    .replaceAll("{diffDaysAfter}", String(diffDaysAfter));
}

/**
 * Oggetto del reminder: segnaposto risolti + " – {cliente finale}" se comune a
 * tutte le righe (salvo che il template lo includa già esplicitamente).
 */
function reminderSubject(tpl: string, d: ReminderEmailData, lang: Lang = "it"): string {
  const filled = fillReminderPlaceholders(tpl, d, lang).replaceAll("\n", " ");
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

/** Testi cliente di DEFAULT in inglese (singolare). Il corpo segue "Hi {name}, ". */
const REMINDER_CLIENT_DEFAULTS_EN: Record<
  ReminderConfigurableType,
  { subject: string; body: string; title: string }
> = {
  PROMEMORIA_30: {
    subject: "Your {serviceName} service is about to expire",
    body: "this is a reminder that your {serviceName} service will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your service is about to expire",
  },
  PROMEMORIA_15: {
    subject: "Your {serviceName} service is about to expire",
    body: "this is a reminder that your {serviceName} service will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your service is about to expire",
  },
  PROMEMORIA_7: {
    subject: "Your {serviceName} service is about to expire",
    body: "this is a reminder that your {serviceName} service will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your service is about to expire",
  },
  SOLLECITO: {
    subject: "Your {serviceName} service has expired",
    body: "your {serviceName} service expired on {endDate} and has not yet been renewed. Please settle the payment as soon as possible to avoid the service being interrupted.",
    title: "Your service has expired",
  },
  CESSAZIONE_MOROSITA: {
    subject: "Your {serviceName} service has been discontinued",
    body: "we would like to inform you that your {serviceName} service has been discontinued because it was not renewed within the period allowed after expiry. If you would like to reactivate it, please contact us as soon as possible.",
    title: "Your service has been discontinued",
  },
};

/** Varianti PLURALI in inglese (più servizi nella stessa email). */
const REMINDER_CLIENT_DEFAULTS_PLURAL_EN: Record<
  ReminderConfigurableType,
  { subject: string; body: string; title: string }
> = {
  PROMEMORIA_30: {
    subject: "Your services expire on {endDate}",
    body: "this is a reminder that the services listed below will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your services are about to expire",
  },
  PROMEMORIA_15: {
    subject: "Your services expire on {endDate}",
    body: "this is a reminder that the services listed below will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your services are about to expire",
  },
  PROMEMORIA_7: {
    subject: "Your services expire on {endDate}",
    body: "this is a reminder that the services listed below will expire on {endDate} (in {diffDays} days). To avoid any interruption, please arrange the renewal in good time.",
    title: "Your services are about to expire",
  },
  SOLLECITO: {
    subject: "Your services expired on {endDate}",
    body: "the services listed below expired on {endDate} and have not yet been renewed. Please settle the payment as soon as possible to avoid the services being interrupted.",
    title: "Your services have expired",
  },
  CESSAZIONE_MOROSITA: {
    subject: "Your services have been discontinued",
    body: "we would like to inform you that the services listed below have been discontinued because they were not renewed within the period allowed after expiry. If you would like to reactivate them, please contact us as soon as possible.",
    title: "Your services have been discontinued",
  },
};

/** Testi cliente di default (singolare) per lingua: usati da Impostazioni e dal cron. */
export const REMINDER_CLIENT_DEFAULTS_BY_LANG: Record<
  Lang,
  Record<ReminderConfigurableType, { subject: string; body: string; title: string }>
> = {
  it: REMINDER_CLIENT_DEFAULTS,
  en: REMINDER_CLIENT_DEFAULTS_EN,
};

const REMINDER_CLIENT_DEFAULTS_PLURAL_BY_LANG: Record<
  Lang,
  Record<ReminderConfigurableType, { subject: string; body: string; title: string }>
> = {
  it: REMINDER_CLIENT_DEFAULTS_PLURAL,
  en: REMINDER_CLIENT_DEFAULTS_PLURAL_EN,
};

/** Blocco dettagli per il CLIENTE (servizi + scadenza, nessun link admin). */
function clientDetailsText(d: ReminderEmailData, lang: Lang = "it"): string {
  return [
    d.items.length === 1
      ? `${tr(lang, { it: "Servizio:  ", en: "Service:     " })}${serviceLineText(d.items[0].serviceName, d.items[0].endClientName, lang)}`
      : `${tr(lang, { it: "Servizi:", en: "Services:" })}\n${reminderServiceLinesText(d, lang)}`,
    `${tr(lang, { it: "Scadenza:  ", en: "Expiry date: " })}${formatDate(d.endDate, lang)}`,
  ].join("\n");
}

function clientDetailsHtml(d: ReminderEmailData, lang: Lang = "it"): string {
  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;color:#1e293b">
      ${reminderServiceRowsHtml(d, lang)}
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">${tr(lang, { it: "Scadenza", en: "Expiry date" })}</td><td>${formatDate(d.endDate, lang)}</td></tr>
    </table>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Sezione RINNOVO del reminder CLIENTE (righe senza rinnovo automatico):
// pagamento online con carta tramite il link /pay (unica modalità per il cliente).
// ──────────────────────────────────────────────────────────────────────────

const RENEWAL_PRICE_MAY_VARY: Record<Lang, string> = {
  it: "Il prezzo dei rinnovi successivi potrebbe variare, in aumento o in diminuzione, rispetto a quello indicato.",
  en: "The price of subsequent renewals may vary, upwards or downwards, from the one shown.",
};
const RENEWAL_PRICE_LOCKED: Record<Lang, string> = {
  it: "Dal rinnovo successivo il prezzo resterà invariato.",
  en: "From the next renewal onwards the price will remain unchanged.",
};

/** Riga coperta dal reminder, per il disclaimer sul periodo e sul prezzo. */
export type RenewalTermsItem = {
  serviceName: string;
  billingPeriod: BillingPeriodValue;
  /** true = aumento "una sola volta" (ONCE): dopo questo rinnovo il prezzo non cambia. */
  priceLocked: boolean;
};

/** "il prossimo anno" / "il prossimo mese" / "il prossimo periodo (di ciascun servizio)". */
function renewalPeriodPhrase(items: RenewalTermsItem[], lang: Lang = "it"): string {
  const periods = new Set(items.map((it) => it.billingPeriod));
  if (periods.size > 1)
    return tr(lang, {
      it: "il prossimo periodo di ciascun servizio",
      en: "the next period of each service",
    });
  const [p] = [...periods];
  return p === "ANNUALE"
    ? tr(lang, { it: "il prossimo anno", en: "the next year" })
    : p === "MENSILE"
      ? tr(lang, { it: "il prossimo mese", en: "the next month" })
      : tr(lang, { it: "il prossimo periodo", en: "the next period" });
}

/**
 * Disclaimer sotto il riepilogo (Caso A): periodo reale coperto e, per il
 * prezzo, "potrebbe variare" (EVERY_RENEWAL) o "resterà invariato" (ONCE).
 * Con righe miste: variazione + elenco dei servizi a prezzo bloccato.
 */
function renewalDisclaimerLines(items: RenewalTermsItem[], lang: Lang = "it"): string[] {
  const first = tr(lang, {
    it: `Questo importo si riferisce al rinnovo per ${renewalPeriodPhrase(items, lang)}.`,
    en: `This amount refers to the renewal for ${renewalPeriodPhrase(items, lang)}.`,
  });
  const mayVary = RENEWAL_PRICE_MAY_VARY[lang];
  const lockedText = RENEWAL_PRICE_LOCKED[lang];
  const locked = items.filter((it) => it.priceLocked);
  if (items.length > 0 && locked.length === items.length) {
    return [first, lockedText];
  }
  if (locked.length === 0) return [`${first} ${mayVary}`];
  return [
    `${first} ${mayVary}`,
    `${locked.map((it) => it.serviceName).join(", ")}: ${lockedText.charAt(0).toLowerCase()}${lockedText.slice(1)}`,
  ];
}

const RENEWAL_DISCLAIMER_CESSATION: Record<Lang, string> = {
  it: "Il tuo servizio è stato sospeso per mancato rinnovo. Effettuando il pagamento del rinnovo, faremo il possibile per riattivarlo; se la riattivazione non fosse possibile, valuteremo un rimborso. In alcuni casi potrebbero essere necessari ulteriori accordi economici per il ripristino del servizio. Ti invitiamo a contattarci a hello@deltasolutions.agency prima di procedere al pagamento, per verificare la situazione specifica del tuo servizio.",
  en: "Your service has been suspended because it was not renewed. If you pay for the renewal, we will do our best to reactivate it; should reactivation not be possible, we will consider a refund. In some cases further financial arrangements may be needed to restore the service. Please contact us at hello@deltasolutions.agency before making the payment, so we can check the specific situation of your service.",
};

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
const NET_ONLY_LABEL: Record<Lang, string> = {
  it: "Imponibile (IVA esclusa)",
  en: "Taxable amount (excl. VAT)",
};
const NET_ONLY_NOTE: Record<Lang, string> = {
  it: "IVA e commissione di servizio sono indicate nella pagina di pagamento.",
  en: "VAT and the service fee are shown on the payment page.",
};

/** Blocchi testo (pagamento online + disclaimer + CTA). */
function clientRenewalText(
  info: ClientRenewalInfo,
  isCessation: boolean,
  lang: Lang = "it",
): string[] {
  const p = cardPaymentSummary(info);
  const c = info.currency;
  const blocks: string[] = [];
  if (info.payUrl) {
    blocks.push(
      "",
      tr(lang, { it: "Paga online con carta:", en: "Pay online by card:" }),
      `${NET_ONLY_LABEL[lang]}: ${formatEur(p.netCents, c, lang)}`,
      NET_ONLY_NOTE[lang],
      "",
      `${tr(lang, { it: "Paga online", en: "Pay online" })}: ${info.payUrl}`,
    );
  }
  if (isCessation) blocks.push("", RENEWAL_DISCLAIMER_CESSATION[lang]);
  else for (const line of renewalDisclaimerLines(info.terms, lang)) blocks.push("", line);
  if (!isCessation && info.autoChargeUrl) {
    blocks.push(
      "",
      tr(lang, {
        it: `Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico: ${info.autoChargeUrl}`,
        en: `Would you rather not have to think about it every time? Turn on automatic renewal: ${info.autoChargeUrl}`,
      }),
    );
  }
  return blocks;
}

/** Blocco HTML (pagamento online + disclaimer + CTA). */
function clientRenewalHtml(
  info: ClientRenewalInfo,
  isCessation: boolean,
  lang: Lang = "it",
): string {
  const p = cardPaymentSummary(info);
  const c = info.currency;
  const mono = "font-family:'Space Mono','Courier New',monospace";
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:3px 0;color:${strong ? "#12161F" : "#64748b"};${strong ? "font-weight:700;border-top:1px solid #E2DED6;padding-top:8px" : ""}">${label}</td><td style="padding:3px 0;text-align:right;${mono};${strong ? "font-weight:700;color:#12161F;border-top:1px solid #E2DED6;padding-top:8px" : ""}">${value}</td></tr>`;
  const payBlock = info.payUrl
    ? `
    <div style="margin:16px 0;border:1px solid #E2DED6;border-left:4px solid #2B7FFF;border-radius:8px;background:#FAFAFA;padding:14px 16px">
      <p style="font-size:14px;font-weight:600;margin:0 0 8px;color:#12161F">${tr(lang, { it: "Paga online con carta", en: "Pay online by card" })}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#4A463F">
        ${row(NET_ONLY_LABEL[lang], formatEur(p.netCents, c, lang), true)}
      </table>
      <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">${NET_ONLY_NOTE[lang]}</p>
      <p style="margin:14px 0 0">
        <a href="${h(info.payUrl)}" style="display:inline-block;background:#2B7FFF;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">${tr(lang, { it: "Paga online", en: "Pay online" })} →</a>
      </p>
    </div>`
    : "";
  const disclaimer = (
    isCessation
      ? [RENEWAL_DISCLAIMER_CESSATION[lang]]
      : renewalDisclaimerLines(info.terms, lang)
  )
    .map((l) => h(l))
    .join("<br/>");
  const cta =
    !isCessation && info.autoChargeUrl
      ? `
      <p style="font-size:14px;line-height:1.5;margin:14px 0 6px">${tr(lang, { it: "Vuoi evitare di doverci pensare ogni volta? Attiva il rinnovo automatico.", en: "Would you rather not have to think about it every time? Turn on automatic renewal." })}</p>
      <p style="margin:0 0 4px">
        <a href="${h(info.autoChargeUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${tr(lang, { it: "Attiva il rinnovo automatico", en: "Turn on automatic renewal" })} →</a>
      </p>`
      : "";
  return `
    ${payBlock}
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
    /**
     * Lingua del cliente (solo audience "client"; default "it"). L'`override`
     * passato dal chiamante DEVE essere quello della stessa lingua.
     */
    lang?: Lang;
  },
): EmailContent {
  const audience = opts?.audience ?? "admin";
  const lang: Lang = audience === "client" ? (opts?.lang ?? "it") : "it";
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
        ? REMINDER_CLIENT_DEFAULTS_PLURAL_BY_LANG[lang]
        : REMINDER_CLIENT_DEFAULTS_BY_LANG[lang]
    )[type as ReminderConfigurableType];
    // Testi personalizzati da Impostazioni (se presenti) al posto dei default.
    const override = opts?.override;
    const subject = reminderSubject(
      override?.subject?.trim() ? override.subject : cdef.subject,
      d,
      lang,
    );
    const intro = fillReminderPlaceholders(
      override?.body?.trim() ? override.body : cdef.body,
      d,
      lang,
    );

    // Sezione rinnovo (coordinate + disclaimer + eventuale CTA): compare SOLO se
    // l'item non ha il rinnovo automatico attivo (clientRenewal valorizzato).
    // Il disclaimer/CTA dipendono dal tipo: cessazione = Caso B (no CTA).
    const renewal = opts?.clientRenewal;
    const isCessation = type === "CESSAZIONE_MOROSITA";
    const renewalTextBlocks = renewal
      ? clientRenewalText(renewal, isCessation, lang)
      : [];
    const renewalHtmlBlock = renewal
      ? clientRenewalHtml(renewal, isCessation, lang)
      : "";

    const text = [
      helloText(d.clientName, lang),
      "",
      intro,
      "",
      clientDetailsText(d, lang),
      ...renewalTextBlocks,
      "",
      contactLineText(lang),
    ].join("\n");

    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
        ${emailHeaderHtml()}
        <h2 style="font-size:18px;margin:0 0 8px">${cdef.title}</h2>
        <p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)} ${multilineHtml(intro)}</p>
        ${clientDetailsHtml(d, lang)}
        ${renewalHtmlBlock}
        <p style="font-size:13px;color:#64748b;line-height:1.5;margin-top:12px">
          ${contactLineText(lang).replace(
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
  /**
   * Primo pagamento (attivazione): le date non si spostano, la colonna mostra
   * "Attivo fino al" invece di "Nuova scadenza".
   */
  activation?: boolean;
  /** Solo admin: data di inizio già passata alla conferma dell'attivazione. */
  startDateWarning?: string | null;
  /** Lingua del cliente (solo audience "client"; default "it"). */
  lang?: Lang;
};

function methodLabel(method: PaymentMethod, lang: Lang = "it"): string {
  return method === "STRIPE"
    ? tr(lang, { it: "Carta di credito (Stripe)", en: "Credit card (Stripe)" })
    : tr(lang, { it: "Pagamento manuale", en: "Manual payment" });
}

/** Etichetta breve dei servizi per l'oggetto: nome singolo o "N servizi". */
function servicesLabel(items: { serviceName: string }[], lang: Lang = "it"): string {
  return items.length === 1
    ? items[0].serviceName
    : tr(lang, { it: `${items.length} servizi`, en: `${items.length} services` });
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
  // La versione admin resta sempre in italiano.
  const lang: Lang = isClient ? (d.lang ?? "it") : "it";
  const currency = d.currency ?? "eur";

  const total = formatEur(d.totalCents, currency, lang);
  // Imponibile/IVA presi dalla ricevuta (base IVA = solo servizi, il costo di
  // servizio NON concorre); fallback allo scorporo dal totale solo se non
  // forniti (retro-compatibilità).
  const fallback = splitVatFromGross(d.totalCents);
  const taxableCents = d.taxableCents ?? fallback.taxableCents;
  const vatCents = d.vatCents ?? fallback.vatCents;
  const feeCents = d.serviceFeeCents ?? 0;
  const vatLine = tr(lang, {
    it:
      `di cui imponibile ${formatEur(taxableCents, currency)} + IVA 22% ${formatEur(vatCents, currency)}` +
      (feeCents > 0 ? ` + costi di servizio ${formatEur(feeCents, currency)}` : ""),
    en:
      `of which taxable amount ${formatEur(taxableCents, currency, "en")} + VAT 22% ${formatEur(vatCents, currency, "en")}` +
      (feeCents > 0 ? ` + Radar service costs ${formatEur(feeCents, currency, "en")}` : ""),
  });
  const base = process.env.APP_URL ?? "";
  const receiptUrl = d.receiptToken ? `${base}/r/${d.receiptToken}` : null;
  // Link dashboard SOLO per l'admin — mai nella versione cliente.
  const detail = isClient ? null : `${base}/abbonamenti/${d.subscriptionId}`;
  const label = servicesLabel(d.items, lang);

  const subject = isClient
    ? tr(lang, {
        it: `Radar — Pagamento ricevuto: ${label}`,
        en: `Radar — Payment received: ${label}`,
      })
    : `[Radar] Pagamento confermato: ${d.clientName} — ${label}`;

  const intro = isClient
    ? d.activation
      ? tr(lang, {
          it: "Grazie! Abbiamo ricevuto il tuo pagamento: i servizi sono attivi. Di seguito il riepilogo.",
          en: "Thank you! We have received your payment and your services are now active. Here is a summary.",
        })
      : tr(lang, {
          it: "Grazie! Abbiamo ricevuto il tuo pagamento. Di seguito il riepilogo.",
          en: "Thank you! We have received your payment. Here is a summary.",
        })
    : d.activation
      ? "Abbiamo registrato il primo pagamento: l'abbonamento è ora attivo."
      : "Abbiamo registrato il pagamento per l'abbonamento.";
  const endLabel = d.activation
    ? tr(lang, { it: "attivo fino al", en: "active until" })
    : tr(lang, { it: "nuova scadenza", en: "new expiry date" });
  const endHeader = d.activation
    ? tr(lang, { it: "Attivo fino al", en: "Active until" })
    : tr(lang, { it: "Nuova scadenza", en: "New expiry date" });
  const warning = !isClient && d.startDateWarning ? d.startDateWarning : null;

  const receiptLineText = receiptUrl
    ? `${tr(lang, { it: "Ricevuta:  ", en: "Receipt: " })}${receiptUrl}`
    : tr(lang, {
        it: "Ricevuta:  in generazione, sarà disponibile a breve.",
        en: "Receipt: being generated, it will be available shortly.",
      });

  // Nota fatturazione: solo nella versione cliente.
  const invoiceNote = tr(lang, {
    it: "Riceverai la fattura relativa a questo pagamento entro 12 giorni lavorativi.",
    en: "You will receive the invoice for this payment within 12 working days.",
  });

  const itemLinesText = d.items.map(
    (it) =>
      `- ${serviceLineText(it.serviceName, it.endClientName, lang)}: ${formatEur(it.amountCents, currency, lang)} · ${endLabel} ${formatDate(it.newEndDate, lang)}`,
  );

  const textLines = [
    intro,
    "",
    ...(warning ? [`ATTENZIONE: ${warning}`, ""] : []),
    ...(isClient ? [] : [`Cliente: ${d.clientName}`, ""]),
    tr(lang, { it: "Servizi:", en: "Services:" }),
    ...itemLinesText,
    "",
    `${tr(lang, { it: "Totale:  ", en: "Total:   " })}${total}`,
    `         (${vatLine})`,
    `${tr(lang, { it: "Metodo:  ", en: "Method:  " })}${methodLabel(d.method, lang)}`,
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
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName, lang)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency, lang)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;color:#64748b">${formatDate(it.newEndDate, lang)}</td>
        </tr>`,
    )
    .join("");

  const receiptLinkHtml = receiptUrl
    ? `<a href="${h(receiptUrl)}" style="color:#4f46e5">${tr(lang, { it: "Visualizza la ricevuta", en: "View the receipt" })} →</a><br/>`
    : `<span style="color:#64748b">${tr(lang, { it: "Ricevuta in generazione, disponibile a breve.", en: "Receipt being generated, available shortly." })}</span><br/>`;

  const detailLinkHtml = detail
    ? `<a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a>`
    : "";

  const title = isClient
    ? tr(lang, { it: "Pagamento ricevuto", en: "Payment received" })
    : "Pagamento confermato";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${title}</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${warning ? `<p style="font-size:14px;line-height:1.5;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:8px;padding:10px 12px">${h(warning)}</p>` : ""}
      ${clientRowHtml}
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Servizio", en: "Service" })}</th>
            <th style="padding:0 12px 6px 0;font-weight:500;text-align:right">${tr(lang, { it: "Importo", en: "Amount" })}</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">${endHeader}</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">${tr(lang, { it: "Totale", en: "Total" })}</td>
            <td style="padding:8px 12px 0 0;font-weight:600;text-align:right">${total}</td>
            <td style="padding:8px 0 0"></td>
          </tr>
          <tr>
            <td colspan="3" style="padding:2px 0 0;text-align:right;font-size:12px;color:#94a3b8">${vatLine}</td>
          </tr>
        </tfoot>
      </table>
      <p style="font-family:sans-serif;font-size:14px;margin-top:8px">
        <span style="color:#64748b">${tr(lang, { it: "Metodo:", en: "Method:" })}</span> ${methodLabel(d.method, lang)}
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
  /**
   * Abbonamento "da pagare": blocco "Primo pagamento" con l'imponibile e il
   * pulsante "Paga ora" (/pay). IVA e commissione sono sulla pagina /pay.
   */
  firstPayment?: FirstPaymentBlock | null;
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
};

const CONTACT_EMAIL = "hello@deltasolutions.agency";

// ──────────────────────────────────────────────────────────────────────────
// PRIMO PAGAMENTO — blocco condiviso da benvenuto, "Attivazione nuovi servizi"
// e solleciti. Come i reminder: solo imponibile in email.
// ──────────────────────────────────────────────────────────────────────────

export type FirstPaymentBlock = {
  /** URL della pagina /pay/{token} del pagamento di attivazione. */
  payUrl: string;
  /** Imponibile del primo pagamento (prezzo iniziale × quantità, IVA esclusa). */
  netCents: number;
  currency: string;
};

const FIRST_PAYMENT_INTRO: Record<Lang, string> = {
  it: "I servizi si attivano con il primo pagamento. Puoi pagare con carta tramite il link sicuro qui sotto.",
  en: "Your services are activated with the first payment. You can pay by card using the secure link below.",
};

function firstPaymentTitle(lang: Lang): string {
  return tr(lang, { it: "Primo pagamento", en: "First payment" });
}

function payNowLabel(lang: Lang): string {
  return tr(lang, { it: "Paga ora", en: "Pay now" });
}

function firstPaymentBlockText(b: FirstPaymentBlock, lang: Lang = "it"): string[] {
  return [
    "",
    firstPaymentTitle(lang),
    FIRST_PAYMENT_INTRO[lang],
    `${NET_ONLY_LABEL[lang]}: ${formatEur(b.netCents, b.currency, lang)}`,
    NET_ONLY_NOTE[lang],
    `${payNowLabel(lang)}: ${b.payUrl}`,
    PAYMENT_LINK_VALIDITY_NOTE[lang],
  ];
}

function firstPaymentBlockHtml(b: FirstPaymentBlock, lang: Lang = "it"): string {
  return `<div style="margin:16px 0;border:1px solid #c7d2fe;border-radius:12px;padding:16px;background:#eef2ff">
        <h3 style="font-size:15px;margin:0 0 6px">${firstPaymentTitle(lang)}</h3>
        <p style="font-size:14px;line-height:1.5;margin:0 0 10px">${FIRST_PAYMENT_INTRO[lang]}</p>
        <p style="font-size:14px;margin:0"><span style="color:#64748b">${NET_ONLY_LABEL[lang]}:</span> <strong>${formatEur(b.netCents, b.currency, lang)}</strong></p>
        <p style="font-size:12px;color:#64748b;margin:4px 0 14px">${NET_ONLY_NOTE[lang]}</p>
        <a href="${h(b.payUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${payNowLabel(lang)} →</a>
        <p style="font-size:12px;color:#64748b;margin:10px 0 0">${PAYMENT_LINK_VALIDITY_NOTE[lang]}</p>
      </div>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Sezione DATI DI FATTURAZIONE (sola lettura + CTA) — condivisa da benvenuto
// e richiesta di verifica dati. Il disclaimer è identico in entrambe.
// ──────────────────────────────────────────────────────────────────────────

/** Dato di fatturazione: l'etichetta è già nella lingua del cliente (billingDataFor). */
export type BillingDatum = { label: string; value: string };

export const BILLING_DATA_DISCLAIMER =
  "Puoi rivedere questi dati quando vuoi da questo link. Se qualcosa non è corretto, potrai modificarlo una sola volta: dopo il salvataggio, per un'ulteriore modifica dovrai richiedercelo scrivendo a hello@deltasolutions.agency.";

export const BILLING_DATA_DISCLAIMER_BY_LANG: Record<Lang, string> = {
  it: BILLING_DATA_DISCLAIMER,
  en: "You can review these details at any time from this link. If something is not correct, you can change it once: after saving, any further change must be requested by writing to us at hello@deltasolutions.agency.",
};

const dashValue = (v: string) => (v.trim() ? v : "—");

function billingDataHeading(lang: Lang): string {
  return tr(lang, { it: "I tuoi dati di fatturazione", en: "Your billing details" });
}

/** Blocco dati di fatturazione + CTA + disclaimer, versione testo. */
function billingDataSectionText(
  data: BillingDatum[],
  url: string,
  ctaLabel: string,
  lang: Lang = "it",
): string[] {
  return [
    "",
    `${billingDataHeading(lang)}:`,
    ...data.map((d) => `- ${d.label}: ${dashValue(d.value)}`),
    "",
    `${ctaLabel}: ${url}`,
    "",
    BILLING_DATA_DISCLAIMER_BY_LANG[lang],
  ];
}

/** Blocco dati di fatturazione + CTA + disclaimer, versione HTML. */
function billingDataSectionHtml(
  data: BillingDatum[],
  url: string,
  ctaLabel: string,
  lang: Lang = "it",
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
      <h3 style="font-size:15px;margin:0 0 10px">${billingDataHeading(lang)}</h3>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:14px 0 10px">
        <a href="${h(url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${ctaLabel} →</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">${BILLING_DATA_DISCLAIMER_BY_LANG[lang]}</p>
    </div>`;
}

/**
 * Email di BENVENUTO inviata UNA sola volta per cliente, alla creazione del suo
 * primo abbonamento. Presenta la transizione Deltaweb → Delta Solutions Agency,
 * elenca i servizi attivati e spiega che Radar gestirà scadenze e pagamenti.
 * Rivolta al cliente: solo link pubblici (privacy/termini), nessun link interno.
 */
export function buildWelcomeEmail(d: WelcomeEmailData): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const base = process.env.APP_URL ?? "";
  const langQuery = lang === "en" ? "?lang=en" : "";
  const privacyUrl = `${base}/privacy${langQuery}`;
  const termsUrl = `${base}/termini${langQuery}`;

  const subject = tr(lang, {
    it: "Benvenuto in Delta Solutions Agency — la tua area Radar",
    en: "Welcome to Delta Solutions Agency — your Radar area",
  });

  const intro = tr(lang, {
    it: "Ti diamo il benvenuto! Deltaweb è ora Delta Solutions Agency: cambiano il nome e l'immagine, ma restano lo stesso team e la stessa cura dei tuoi servizi. Da oggi la gestione di scadenze, rinnovi e pagamenti passa attraverso Radar, la nostra piattaforma dedicata.",
    en: "Welcome! Deltaweb is now Delta Solutions Agency: the name and the look are changing, but the team and the care we put into your services stay the same. From today, expiry dates, renewals and payments are managed through Radar, our dedicated platform.",
  });

  const explanation = tr(lang, {
    it: "Con Radar riceverai promemoria automatici prima di ogni scadenza, link di pagamento sicuri e le ricevute dei tuoi rinnovi, tutto in un unico posto. Non devi fare nulla: ci pensiamo noi a tenere tutto in ordine.",
    en: "With Radar you will receive automatic reminders before every expiry date, secure payment links and the receipts for your renewals, all in one place. You don't need to do anything: we will keep everything in order.",
  });

  const expiresOn = (expiry: string) =>
    tr(lang, { it: `scade il ${expiry}`, en: `expires on ${expiry}` });

  const itemLabel = (it: WelcomeEmailItem) => {
    const name = it.quantity > 1 ? `${it.serviceName} ×${it.quantity}` : it.serviceName;
    const period = formatBillingPeriod(it.billingPeriod, it.customPeriodDays, lang);
    const price = formatEur(it.priceCents * it.quantity, it.currency ?? "eur", lang);
    const expiry = formatDate(it.endDate, lang);
    return { name, period, price, expiry };
  };

  const itemLinesText = d.items.map((it) => {
    const { name, period, price, expiry } = itemLabel(it);
    return `- ${serviceLineText(name, it.endClientName, lang)} — ${period} — ${expiresOn(expiry)} — ${price}*`;
  });

  const autoChargeLongText = tr(lang, {
    it: "Per non pensare più alle scadenze, puoi attivare il rinnovo automatico: registri una carta una sola volta e i servizi indicati verranno rinnovati e addebitati in automatico. Puoi revocarlo quando vuoi.",
    en: "So you no longer have to think about expiry dates, you can turn on automatic renewal: you register a card just once and the services listed will be renewed and charged automatically. You can revoke it whenever you like.",
  });

  // Sezione rinnovo automatico (solo se richiesto in creazione).
  const autoChargeText = d.autoChargeUrl
    ? [
        "",
        tr(lang, { it: "Rinnovo automatico", en: "Automatic renewal" }),
        autoChargeLongText,
        `${tr(lang, { it: "Attiva ora", en: "Activate now" })}: ${d.autoChargeUrl}`,
      ]
    : [];

  const dataCta = tr(lang, {
    it: "Visualizza o correggi i tuoi dati",
    en: "View or correct your details",
  });

  // Sezione dati di fatturazione (sola lettura) + CTA + disclaimer.
  const dataSectionText =
    d.dataEditUrl && d.billingData
      ? billingDataSectionText(d.billingData, d.dataEditUrl, dataCta, lang)
      : [];

  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    "",
    d.firstPayment
      ? tr(lang, { it: "Servizi da attivare:", en: "Services to be activated:" })
      : tr(lang, { it: "Servizi attivati:", en: "Activated services:" }),
    ...itemLinesText,
    pricesExclVatNote(lang),
    ...(d.firstPayment ? firstPaymentBlockText(d.firstPayment, lang) : []),
    "",
    explanation,
    ...autoChargeText,
    ...dataSectionText,
    "",
    `Privacy Policy: ${privacyUrl}`,
    `${tr(lang, { it: "Termini e Condizioni", en: "Terms and Conditions" })}: ${termsUrl}`,
    "",
    contactLineText(lang),
    "",
    teamSignature(lang),
  ].join("\n");

  const itemRowsHtml = d.items
    .map((it) => {
      const { name, period, price, expiry } = itemLabel(it);
      return `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(name, it.endClientName, lang)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${h(period)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap">${expiresOn(expiry)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${price}*</td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Benvenuto in Delta Solutions Agency", en: "Welcome to Delta Solutions Agency" })}</h2>
      <p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)}</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Servizio", en: "Service" })}</th>
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Periodicità", en: "Billing period" })}</th>
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Scadenza", en: "Expiry date" })}</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">${tr(lang, { it: "Prezzo", en: "Price" })}</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:0 0 12px">${pricesExclVatNote(lang)}</p>
      ${d.firstPayment ? firstPaymentBlockHtml(d.firstPayment, lang) : ""}
      <p style="font-size:14px;line-height:1.5">${explanation}</p>
      ${
        d.autoChargeUrl
          ? `<div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc">
        <h3 style="font-size:15px;margin:0 0 6px">${tr(lang, { it: "Attiva il rinnovo automatico", en: "Turn on automatic renewal" })}</h3>
        <p style="font-size:14px;line-height:1.5;margin:0 0 12px">${tr(lang, { it: "Per non pensare più alle scadenze, registra una carta una sola volta: i servizi indicati verranno rinnovati e addebitati in automatico. Puoi revocarlo quando vuoi.", en: "So you no longer have to think about expiry dates, register a card just once: the services listed will be renewed and charged automatically. You can revoke it whenever you like." })}</p>
        <a href="${h(d.autoChargeUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${tr(lang, { it: "Attiva rinnovo automatico", en: "Turn on automatic renewal" })} →</a>
      </div>`
          : ""
      }
      ${
        d.dataEditUrl && d.billingData
          ? billingDataSectionHtml(d.billingData, d.dataEditUrl, dataCta, lang)
          : ""
      }
      <p style="font-size:13px;color:#64748b;line-height:1.6">
        ${tr(lang, {
          it: `Consulta la nostra <a href="${privacyUrl}" style="color:#4f46e5">Privacy Policy</a>
        e i <a href="${termsUrl}" style="color:#4f46e5">Termini e Condizioni</a>.<br/>
        Per qualsiasi domanda scrivici a`,
          en: `Please read our <a href="${privacyUrl}" style="color:#4f46e5">Privacy Policy</a>
        and <a href="${termsUrl}" style="color:#4f46e5">Terms and Conditions</a>.<br/>
        If you have any questions, write to us at`,
        })}
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
}): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const label = servicesLabel(
    d.items.map((it) => ({ serviceName: it.serviceName })),
    lang,
  );
  const subject = tr(lang, {
    it: `Radar — Attiva il rinnovo automatico per ${label}`,
    en: `Radar — Turn on automatic renewal for ${label}`,
  });
  const intro = tr(lang, {
    it: "Puoi attivare il rinnovo automatico registrando una carta: autorizzerai l'addebito ricorrente per i servizi elencati qui sotto, ciascuno alla propria cadenza. Puoi revocare l'autorizzazione in qualsiasi momento scrivendo a hello@deltasolutions.agency.",
    en: "You can turn on automatic renewal by registering a card: you will authorise recurring charges for the services listed below, each on its own schedule. You can revoke the authorisation at any time by writing to hello@deltasolutions.agency.",
  });

  const itemLinesText = d.items.map(
    (it) =>
      `- ${serviceLineText(it.serviceName, it.endClientName, lang)}: ${it.amountLabel}* · ${it.periodicityLabel}`,
  );

  const text = [
    intro,
    "",
    tr(lang, { it: "Servizi inclusi:", en: "Services included:" }),
    ...itemLinesText,
    pricesExclVatNote(lang),
    "",
    `${tr(lang, { it: "Attiva ora", en: "Activate now" })}: ${d.activationUrl}`,
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName, lang)}</td>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;color:#64748b">${h(it.periodicityLabel)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${h(it.amountLabel)}*</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Attiva il rinnovo automatico", en: "Turn on automatic renewal" })}</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <thead>
          <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Servizio", en: "Service" })}</th>
            <th style="padding:0 12px 6px 0;font-weight:500">${tr(lang, { it: "Periodicità", en: "Billing period" })}</th>
            <th style="padding:0 0 6px;font-weight:500;text-align:right">${tr(lang, { it: "Importo", en: "Amount" })}</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:0">${pricesExclVatNote(lang)}</p>
      <p style="margin:20px 0">
        <a href="${h(d.activationUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${tr(lang, { it: "Attiva rinnovo automatico", en: "Turn on automatic renewal" })} →</a>
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
function activationItemsText(r: ActivationRequestInfo, lang: Lang = "it"): string[] {
  return r.items.map((it) => `  - ${serviceLineText(it.serviceName, it.endClientName, lang)}`);
}

/** Elenco servizi di una richiesta, HTML. */
function activationItemsHtml(r: ActivationRequestInfo, lang: Lang = "it"): string {
  if (r.items.length === 0) return "";
  return `<ul style="font-size:14px;padding-left:18px;margin:6px 0">${r.items
    .map((it) => `<li style="margin-bottom:4px">${serviceCellHtml(it.serviceName, it.endClientName, lang)}</li>`)
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
}): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const subject = tr(lang, {
    it: "Radar — Completa l'attivazione del rinnovo automatico",
    en: "Radar — Complete the activation of automatic renewal",
  });
  const intro = tr(lang, {
    it: "ti avevamo proposto l'attivazione del rinnovo automatico, ma non risulta ancora completata. Bastano un paio di minuti: registri la carta una sola volta e non dovrai più pensare alle scadenze.",
    en: "we recently suggested turning on automatic renewal, but the activation has not been completed yet. It only takes a couple of minutes: you register your card just once and you will no longer have to think about expiry dates.",
  });
  const completeLabel = tr(lang, {
    it: "Completa l'attivazione",
    en: "Complete the activation",
  });
  const single = d.requests.length === 1;

  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    ...d.requests.flatMap((r) => [
      "",
      ...(r.items.length > 0
        ? [tr(lang, { it: "Servizi:", en: "Services:" }), ...activationItemsText(r, lang)]
        : []),
      `${completeLabel}: ${r.activationUrl}`,
    ]),
    "",
    tr(lang, {
      it: "Se preferisci non attivarlo o hai domande, scrivici a hello@deltasolutions.agency.",
      en: "If you would rather not turn it on, or have any questions, write to us at hello@deltasolutions.agency.",
    }),
  ].join("\n");

  const requestsHtml = d.requests
    .map(
      (r) => `
      <div style="margin:16px 0;${single ? "" : "border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px"}">
        ${activationItemsHtml(r, lang)}
        <p style="margin:12px 0 0">
          <a href="${h(r.activationUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${completeLabel} →</a>
        </p>
      </div>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Completa l'attivazione del rinnovo automatico", en: "Complete the activation of automatic renewal" })}</h2>
      <p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)} ${h(intro)}</p>
      ${requestsHtml}
      <p style="font-size:13px;color:#64748b;line-height:1.5">${tr(lang, { it: "Se preferisci non attivarlo o hai domande, scrivici a", en: "If you would rather not turn it on, or have any questions, write to us at" })} <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
};

/**
 * Email al cliente che conferma un rimborso (storno) parziale o totale: elenca i
 * servizi rimborsati, l'importo e se il rinnovo di quei servizi è stato
 * annullato. Rivolta al cliente: nessun link interno.
 */
export function buildRefundConfirmationEmail(
  d: RefundConfirmationData,
): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const currency = d.currency ?? "eur";
  const total = formatEur(d.totalCents, currency, lang);
  const label = servicesLabel(d.items, lang);
  const anyReverted = d.items.some((it) => it.renewalReverted);

  const subject = tr(lang, {
    it: `Radar — Rimborso effettuato: ${label}`,
    en: `Radar — Refund issued: ${label}`,
  });
  const intro = tr(lang, {
    it: `Abbiamo effettuato un rimborso ${
      d.isTotal ? "totale" : "parziale"
    } sul tuo pagamento. Di seguito il dettaglio.`,
    en: `We have issued a ${
      d.isTotal ? "full" : "partial"
    } refund on your payment. Please find the details below.`,
  });

  const renewalNote = anyReverted
    ? tr(lang, {
        it: "Il rinnovo dei servizi rimborsati contrassegnati è stato annullato: la scadenza è tornata a quella precedente.",
        en: "The renewal of the refunded services marked above has been cancelled: their expiry date has gone back to the previous one.",
      })
    : null;

  const serviceFeeCents = d.serviceFeeCents ?? 0;

  const itemLinesText = d.items.map(
    (it) =>
      `- ${serviceLineText(it.serviceName, it.endClientName, lang)}: ${formatEur(it.amountCents, currency, lang)}${
        it.renewalReverted
          ? tr(lang, { it: " (rinnovo annullato)", en: " (renewal cancelled)" })
          : ""
      }`,
  );
  if (serviceFeeCents > 0) {
    itemLinesText.push(
      `- ${tr(lang, { it: "Costi di servizio (quota proporzionale)", en: "Radar service costs (proportional share)" })}: ${formatEur(
        serviceFeeCents,
        currency,
        lang,
      )}`,
    );
  }

  const bankNote = tr(lang, {
    it: "Il rimborso sarà visibile sul tuo metodo di pagamento entro qualche giorno lavorativo, secondo i tempi della tua banca.",
    en: "The refund will appear on your payment method within a few working days, depending on your bank's processing times.",
  });
  const totalLabel = tr(lang, { it: "Totale rimborsato", en: "Total refunded" });

  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    "",
    tr(lang, { it: "Servizi rimborsati:", en: "Refunded services:" }),
    ...itemLinesText,
    "",
    `${totalLabel}: ${total}`,
    ...(renewalNote ? ["", renewalNote] : []),
    "",
    bankNote,
    "",
    contactLineText(lang),
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName, lang)}${
            it.renewalReverted
              ? ` <span style="color:#94a3b8;font-size:12px">— ${tr(lang, { it: "rinnovo annullato", en: "renewal cancelled" })}</span>`
              : ""
          }</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency, lang)}</td>
        </tr>`,
    )
    .join("");

  const serviceFeeRowHtml =
    serviceFeeCents > 0
      ? `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${tr(lang, { it: "Costi di servizio", en: "Radar service costs" })} <span style="color:#94a3b8;font-size:12px">— ${tr(lang, { it: "quota proporzionale", en: "proportional share" })}</span></td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(serviceFeeCents, currency, lang)}</td>
        </tr>`
      : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Rimborso effettuato", en: "Refund issued" })}</h2>
      <p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)}</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <tbody>${itemRowsHtml}${serviceFeeRowHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">${totalLabel}</td>
            <td style="padding:8px 0 0;font-weight:600;text-align:right">${total}</td>
          </tr>
        </tfoot>
      </table>
      ${
        renewalNote
          ? `<p style="font-size:13px;color:#64748b;line-height:1.5">${renewalNote}</p>`
          : ""
      }
      <p style="font-size:13px;color:#64748b;line-height:1.5">${bankNote}</p>
      <p style="font-size:13px;color:#64748b;line-height:1.5">${contactMailtoHtml(lang)}</p>
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
};

/** Il link /pay rigenera la sessione Stripe al click: resta valido fino al pagamento. */
const PAYMENT_LINK_VALIDITY_NOTE: Record<Lang, string> = {
  it: "Il link resta valido fino al pagamento.",
  en: "The link remains valid until payment is made.",
};

/**
 * Email al cliente con il link di pagamento Stripe. Rivolta al cliente:
 * elenca i servizi inclusi con il prezzo NETTO (IVA esclusa), l'imponibile
 * complessivo e il pulsante "Paga ora". IVA, commissione e totale sono mostrati sulla pagina
 * /pay dopo il click. Contiene SOLO il link di pagamento, mai link interni.
 */
export function buildPaymentLinkEmail(d: PaymentLinkEmailData): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const currency = d.currency ?? "eur";
  const label = servicesLabel(d.items, lang);
  const netTotal = formatEur(
    d.items.reduce((sum, it) => sum + it.amountCents, 0),
    currency,
    lang,
  );

  const subject = tr(lang, {
    it: `Radar — Link di pagamento: ${label}`,
    en: `Radar — Payment link: ${label}`,
  });
  const intro = tr(lang, {
    it: "Puoi completare il pagamento del tuo abbonamento tramite il link sicuro qui sotto.",
    en: "You can complete the payment for your subscription using the secure link below.",
  });
  const until = (date: Date) =>
    tr(lang, {
      it: `fino al ${formatDate(date)}`,
      en: `until ${formatDate(date, "en")}`,
    });

  const itemLinesText = d.items.map((it) => {
    const per = it.periodEnd ? ` (${until(it.periodEnd)})` : "";
    return `- ${serviceLineText(it.serviceName, it.endClientName, lang)}: ${formatEur(it.amountCents, currency, lang)}*${per}`;
  });

  const text = [
    intro,
    "",
    tr(lang, { it: "Servizi:", en: "Services:" }),
    ...itemLinesText,
    pricesExclVatNote(lang),
    "",
    `${NET_ONLY_LABEL[lang]}: ${netTotal}`,
    NET_ONLY_NOTE[lang],
    "",
    `${payNowLabel(lang)}: ${d.checkoutUrl}`,
    "",
    PAYMENT_LINK_VALIDITY_NOTE[lang],
  ].join("\n");

  const itemRowsHtml = d.items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName, lang)}${it.periodEnd ? `<br/><span style="color:#94a3b8;font-size:12px">${until(it.periodEnd)}</span>` : ""}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.amountCents, currency, lang)}*</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Link di pagamento", en: "Payment link" })}</h2>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b">
        <tbody>${itemRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 12px 0 0;font-weight:600">${NET_ONLY_LABEL[lang]}</td>
            <td style="padding:8px 0 0;text-align:right;white-space:nowrap;font-weight:600">${netTotal}</td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0 0">${pricesExclVatNote(lang)}</p>
      <p style="font-size:12px;color:#94a3b8;margin:4px 0 0">${NET_ONLY_NOTE[lang]}</p>
      <p style="margin:20px 0">
        <a href="${h(d.checkoutUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${payNowLabel(lang)} →</a>
      </p>
      <p style="font-size:12px;color:#64748b">${PAYMENT_LINK_VALIDITY_NOTE[lang]}</p>
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
};

/**
 * Email al cliente con cui l'admin chiede di verificare/aggiornare i propri dati
 * di fatturazione. Riusa la sezione dati (sola lettura + CTA + disclaimer)
 * condivisa con la mail di benvenuto.
 */
export function buildDataUpdateRequestEmail(
  d: DataUpdateRequestData,
): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const subject = tr(lang, {
    it: "Delta Solutions — verifica i tuoi dati di fatturazione",
    en: "Delta Solutions — please check your billing details",
  });
  const intro = tr(lang, {
    it: "Delta Solutions ti chiede di verificare i tuoi dati di fatturazione: controlla che siano corretti e, se serve, aggiornali dal link qui sotto.",
    en: "Delta Solutions kindly asks you to check your billing details: please make sure they are correct and, if needed, update them using the link below.",
  });
  const ctaLabel = tr(lang, { it: "Verifica i tuoi dati", en: "Check your details" });

  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    ...billingDataSectionText(d.billingData, d.dataEditUrl, ctaLabel, lang),
    "",
    contactLineText(lang),
    "",
    teamSignature(lang),
  ].join("\n");

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Verifica i tuoi dati di fatturazione", en: "Check your billing details" })}</h2>
      <p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)}</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${billingDataSectionHtml(d.billingData, d.dataEditUrl, ctaLabel, lang)}
      ${contactFooterHtml(lang)}
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
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
}): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const currency = d.currency ?? "eur";
  const dateStr = formatDate(d.endDate, lang);
  const money = (c: number) => formatEur(c, currency, lang);

  const subject = tr(lang, {
    it: `Radar — Prossimo addebito automatico: ${servicesLabel(d.items, lang)}`,
    en: `Radar — Upcoming automatic charge: ${servicesLabel(d.items, lang)}`,
  });
  const intro =
    d.items.length === 1
      ? tr(lang, {
          it: `Il ${dateStr} verrà addebitato automaticamente sulla carta registrata per il rinnovo di ${d.items[0].serviceName}.`,
          en: `On ${dateStr} the renewal of ${d.items[0].serviceName} will be charged automatically to your registered card.`,
        })
      : tr(lang, {
          it: `Il ${dateStr} verrà addebitato automaticamente sulla carta registrata per il rinnovo dei servizi elencati qui sotto.`,
          en: `On ${dateStr} the renewal of the services listed below will be charged automatically to your registered card.`,
        });
  const showLines = d.items.length > 1 || d.items.some((it) => it.endClientName);
  const serviceLinesText = showLines
    ? [
        "",
        tr(lang, { it: "Servizi:", en: "Services:" }),
        ...d.items.map((it) => `- ${serviceLineText(it.serviceName, it.endClientName, lang)}`),
      ]
    : [];
  const serviceRowsHtml = showLines
    ? `<ul style="font-family:sans-serif;font-size:14px;color:#1e293b;padding-left:18px;margin:8px 0">${d.items
        .map((it) => `<li style="margin-bottom:4px">${serviceCellHtml(it.serviceName, it.endClientName, lang)}</li>`)
        .join("")}</ul>`
    : "";

  const L = {
    net: tr(lang, { it: "Imponibile", en: "Taxable amount" }),
    vat: tr(lang, { it: "IVA (22%)", en: "VAT (22%)" }),
    fee: tr(lang, { it: "Costi di servizio (1,5%)", en: "Radar service costs (1.5%)" }),
    total: tr(lang, { it: "Totale addebitato", en: "Total charged" }),
  };

  const feeTextLine =
    d.serviceFeeCents > 0 ? [`${L.fee}: ${money(d.serviceFeeCents)}`] : [];
  const text = [
    intro,
    ...serviceLinesText,
    "",
    `${L.net}: ${money(d.netCents)}`,
    `${L.vat}: ${money(d.vatCents)}`,
    ...feeTextLine,
    `${L.total}: ${money(d.totalCents)}`,
    "",
    tr(lang, {
      it: "Se vuoi disattivare il rinnovo automatico, scrivici a hello@deltasolutions.agency.",
      en: "If you would like to turn off automatic renewal, write to us at hello@deltasolutions.agency.",
    }),
  ].join("\n");

  const feeRowHtml =
    d.serviceFeeCents > 0
      ? `<tr><td style="padding:2px 0;color:#64748b">${L.fee}</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${money(d.serviceFeeCents)}</td></tr>`
      : "";

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${tr(lang, { it: "Prossimo addebito automatico", en: "Upcoming automatic charge" })}</h2>
      <p style="font-size:14px;line-height:1.5">${h(intro)}</p>
      ${serviceRowsHtml}
      <div style="margin:16px 0;border:1px solid #E2DED6;border-left:4px solid #2B7FFF;border-radius:8px;background:#FAFAFA;padding:14px 16px">
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#4A463F">
          <tr><td style="padding:2px 0;color:#64748b">${L.net}</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${money(d.netCents)}</td></tr>
          <tr><td style="padding:2px 0;color:#64748b">${L.vat}</td><td style="padding:2px 0;text-align:right;font-family:'Space Mono','Courier New',monospace">${money(d.vatCents)}</td></tr>
          ${feeRowHtml}
          <tr><td style="border-top:1px solid #E2DED6;padding:8px 0 0;font-weight:700;color:#12161F">${L.total}</td><td style="border-top:1px solid #E2DED6;padding:8px 0 0;text-align:right;font-weight:700;color:#12161F;font-family:'Space Mono','Courier New',monospace">${money(d.totalCents)}</td></tr>
        </table>
      </div>
      <p style="font-size:13px;color:#64748b;line-height:1.6">${tr(lang, { it: "Se vuoi disattivare il rinnovo automatico, scrivici a", en: "If you would like to turn off automatic renewal, write to us at" })} <a href="mailto:hello@deltasolutions.agency" style="color:#4f46e5">hello@deltasolutions.agency</a>.</p>
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

// ──────────────────────────────────────────────────────────────────────────
// PRIMO PAGAMENTO — "Attivazione nuovi servizi", solleciti, avviso admin
// ──────────────────────────────────────────────────────────────────────────

export type FirstPaymentEmailItem = {
  serviceName: string;
  endClientName?: string | null;
  /** Prezzo iniziale × quantità (netto). */
  netCents: number;
  startDate: Date;
  endDate: Date;
};

function fromToText(start: Date, end: Date, lang: Lang): string {
  return tr(lang, {
    it: `dal ${formatDate(start)} al ${formatDate(end)}`,
    en: `from ${formatDate(start, "en")} to ${formatDate(end, "en")}`,
  });
}

function firstPaymentItemsText(
  items: FirstPaymentEmailItem[],
  currency: string,
  lang: Lang = "it",
): string[] {
  return items.map(
    (it) =>
      `- ${serviceLineText(it.serviceName, it.endClientName, lang)} — ${fromToText(it.startDate, it.endDate, lang)} — ${formatEur(it.netCents, currency, lang)}*`,
  );
}

function firstPaymentItemsHtml(
  items: FirstPaymentEmailItem[],
  currency: string,
  lang: Lang = "it",
): string {
  const rows = items
    .map(
      (it) => `
        <tr>
          <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9">${serviceCellHtml(it.serviceName, it.endClientName, lang)}<br/><span style="color:#94a3b8;font-size:12px">${fromToText(it.startDate, it.endDate, lang)}</span></td>
          <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${formatEur(it.netCents, currency, lang)}*</td>
        </tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;color:#1e293b;margin:8px 0">
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:0 0 12px">${pricesExclVatNote(lang)}</p>`;
}

function clientEmailHtml(title: string, body: string, lang: Lang = "it"): string {
  return `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">${title}</h2>
      ${body}
      ${contactFooterHtml(lang)}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions Agency</p>
    </div>`;
}

export type FirstPaymentEmailData = {
  clientName: string;
  items: FirstPaymentEmailItem[];
  currency: string;
  payment: FirstPaymentBlock;
  /** Lingua del cliente (default "it"). */
  lang?: Lang;
};

/**
 * "Attivazione nuovi servizi": al cliente già servito (benvenuto con PDF già
 * inviato) per un nuovo abbonamento "da pagare", e per il reinvio del link.
 * Solo imponibile in email; IVA e commissione sulla pagina /pay.
 */
export function buildFirstPaymentEmail(d: FirstPaymentEmailData): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const subject = tr(lang, {
    it: "Attivazione nuovi servizi — Delta Solutions Agency",
    en: "Activation of new services — Delta Solutions Agency",
  });
  const intro = tr(lang, {
    it: "abbiamo preparato l'attivazione dei servizi qui sotto. Per renderli attivi è sufficiente completare il primo pagamento.",
    en: "we have prepared the activation of the services below. To make them active, simply complete the first payment.",
  });
  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    "",
    tr(lang, { it: "Servizi da attivare:", en: "Services to be activated:" }),
    ...firstPaymentItemsText(d.items, d.currency, lang),
    pricesExclVatNote(lang),
    ...firstPaymentBlockText(d.payment, lang),
    "",
    contactLineText(lang),
    "",
    teamSignature(lang),
  ].join("\n");
  const html = clientEmailHtml(
    tr(lang, { it: "Attivazione nuovi servizi", en: "Activation of new services" }),
    `<p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)}</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${firstPaymentItemsHtml(d.items, d.currency, lang)}
      ${firstPaymentBlockHtml(d.payment, lang)}`,
    lang,
  );
  return { subject, text, html };
}

/** Sollecito al cliente: primo pagamento non ancora ricevuto (+N giorni). */
export function buildFirstPaymentReminderEmail(
  d: FirstPaymentEmailData & { daysSinceLink: number },
): EmailContent {
  const lang: Lang = d.lang ?? "it";
  const subject = tr(lang, {
    it: "Promemoria: attivazione dei tuoi servizi in attesa di pagamento",
    en: "Reminder: activation of your services is awaiting payment",
  });
  const intro = tr(lang, {
    it: "ti ricordiamo che l'attivazione dei servizi qui sotto è in attesa del primo pagamento. Puoi completarlo in pochi passaggi dal link sicuro.",
    en: "this is a reminder that the activation of the services below is awaiting the first payment. You can complete it in a few steps using the secure link.",
  });
  const alreadyPaid = tr(lang, {
    it: "Se hai già pagato, ignora questo messaggio.",
    en: "If you have already paid, please ignore this message.",
  });
  const text = [
    helloText(d.clientName, lang),
    "",
    intro,
    "",
    tr(lang, { it: "Servizi da attivare:", en: "Services to be activated:" }),
    ...firstPaymentItemsText(d.items, d.currency, lang),
    pricesExclVatNote(lang),
    ...firstPaymentBlockText(d.payment, lang),
    "",
    alreadyPaid,
    contactLineText(lang),
    "",
    teamSignature(lang),
  ].join("\n");
  const html = clientEmailHtml(
    tr(lang, {
      it: "Attivazione in attesa di pagamento",
      en: "Activation awaiting payment",
    }),
    `<p style="font-size:14px;line-height:1.5">${helloText(h(d.clientName), lang)}</p>
      <p style="font-size:14px;line-height:1.5">${intro}</p>
      ${firstPaymentItemsHtml(d.items, d.currency, lang)}
      ${firstPaymentBlockHtml(d.payment, lang)}
      <p style="font-size:13px;color:#64748b">${alreadyPaid}</p>`,
    lang,
  );
  return { subject, text, html };
}

/** Avviso all'admin: primo pagamento non ricevuto dopo N giorni (nessuna cessazione). */
export function buildFirstPaymentAdminAlertEmail(d: {
  subscriptionId: string;
  clientName: string;
  clientEmail: string | null;
  daysSinceLink: number;
  linkSentAt: Date;
  items: FirstPaymentEmailItem[];
  currency: string;
}): EmailContent {
  const detail = detailUrl(d.subscriptionId);
  const net = d.items.reduce((s, it) => s + it.netCents, 0);
  const subject = `[Radar] Primo pagamento non ricevuto: ${d.clientName} (${d.daysSinceLink} gg)`;
  const intro = `Il primo pagamento dell'abbonamento non è ancora arrivato: link inviato il ${formatDate(d.linkSentAt)} (${d.daysSinceLink} giorni fa). Nessuna azione automatica: l'abbonamento resta in attesa.`;
  const text = [
    intro,
    "",
    `Cliente: ${d.clientName}${d.clientEmail ? ` <${d.clientEmail}>` : ""}`,
    "Servizi:",
    ...firstPaymentItemsText(d.items, d.currency),
    `${NET_ONLY_LABEL.it}: ${formatEur(net, d.currency)}`,
    "",
    `Dettaglio: ${detail}`,
  ].join("\n");
  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#1e293b;background-color:#ffffff;padding:24px;border-radius:12px">
      ${emailHeaderHtml()}
      <h2 style="font-size:18px;margin:0 0 8px">Primo pagamento non ricevuto</h2>
      <p style="font-size:14px;line-height:1.5">${h(intro)}</p>
      <p style="font-size:14px;margin:0 0 8px"><span style="color:#64748b">Cliente:</span> ${h(d.clientName)}${d.clientEmail ? ` &lt;${h(d.clientEmail)}&gt;` : ""}</p>
      ${firstPaymentItemsHtml(d.items, d.currency)}
      <p style="font-size:14px"><span style="color:#64748b">${NET_ONLY_LABEL.it}:</span> <strong>${formatEur(net, d.currency)}</strong></p>
      <p style="font-size:14px"><a href="${detail}" style="color:#4f46e5">Apri il dettaglio dell'abbonamento →</a></p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#94a3b8">Radar — Delta Solutions</p>
    </div>`;
  return { subject, text, html };
}
