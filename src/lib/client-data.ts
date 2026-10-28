import "server-only";
import { randomBytes } from "crypto";
import type { Client } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanAddressPart } from "@/lib/address";
import type { Lang } from "@/lib/i18n";

/**
 * Campi dei dati di fatturazione che il cliente può VISUALIZZARE e MODIFICARE
 * dalla pagina pubblica self-service. L'email è volutamente ESCLUSA: non è mai
 * modificabile dal cliente. L'ordine qui definito è quello usato in tutte le UI
 * (pagina pubblica, email di notifica, log) per coerenza.
 */
export const CLIENT_DATA_FIELDS = [
  { key: "ragioneSociale", label: "Ragione sociale", labelEn: "Company name" },
  { key: "partitaIva", label: "Partita IVA", labelEn: "VAT number" },
  { key: "codiceFiscale", label: "Codice fiscale", labelEn: "Tax code" },
  { key: "indirizzo", label: "Indirizzo", labelEn: "Address" },
  { key: "citta", label: "Città", labelEn: "City" },
  { key: "cap", label: "CAP", labelEn: "Postcode" },
  { key: "provincia", label: "Provincia", labelEn: "Province" },
  { key: "sdi", label: "Codice SDI", labelEn: "SDI code (e-invoicing)" },
  { key: "pec", label: "PEC", labelEn: "PEC (certified email)" },
] as const;

/** Etichetta di un campo nella lingua richiesta (default italiano). */
function fieldLabel(
  f: (typeof CLIENT_DATA_FIELDS)[number],
  lang: Lang = "it",
): string {
  return lang === "en" ? f.labelEn : f.label;
}

export type ClientDataFieldKey = (typeof CLIENT_DATA_FIELDS)[number]["key"];

export const CLIENT_DATA_FIELD_LABELS: Record<ClientDataFieldKey, string> =
  Object.fromEntries(
    CLIENT_DATA_FIELDS.map((f) => [f.key, f.label]),
  ) as Record<ClientDataFieldKey, string>;

/** Estrae i soli campi di fatturazione (stringa vuota se null) da un Client. */
export function pickClientData(
  client: Pick<Client, ClientDataFieldKey>,
): Record<ClientDataFieldKey, string> {
  const out = {} as Record<ClientDataFieldKey, string>;
  for (const { key } of CLIENT_DATA_FIELDS) {
    out[key] = (client[key] ?? "") as string;
  }
  return out;
}

/**
 * Costruisce l'array di campi (key/label/value/type) per la pagina pubblica e la
 * pagina attiva-rinnovo. La PEC usa input type email; gli altri text.
 */
export function clientDataFieldsFor(
  client: Pick<Client, ClientDataFieldKey>,
  lang: Lang = "it",
): { key: ClientDataFieldKey; label: string; value: string; type: string }[] {
  const data = pickClientData(client);
  return CLIENT_DATA_FIELDS.map((f) => ({
    key: f.key,
    label: fieldLabel(f, lang),
    value: data[f.key],
    type: f.key === "pec" ? "email" : "text",
  }));
}

const ADDRESS_KEYS: ReadonlySet<ClientDataFieldKey> = new Set(["indirizzo", "citta", "cap", "provincia"]);

/**
 * Coppie label/value dei dati di fatturazione, per le sezioni email (etichette
 * nella lingua `lang`, default italiano). Le parti
 * dell'indirizzo sono ripulite da virgole/spazi finali (cleanAddressPart).
 */
export function billingDataFor(
  client: Pick<Client, ClientDataFieldKey>,
  lang: Lang = "it",
): { label: string; value: string }[] {
  const data = pickClientData(client);
  return CLIENT_DATA_FIELDS.map((f) => ({
    label: fieldLabel(f, lang),
    value: ADDRESS_KEYS.has(f.key) ? cleanAddressPart(data[f.key]) : data[f.key],
  }));
}

/** Diff prima/dopo sui soli campi effettivamente cambiati. */
export function diffClientData(
  before: Record<ClientDataFieldKey, string>,
  after: Record<ClientDataFieldKey, string>,
): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const { key } of CLIENT_DATA_FIELDS) {
    const from = (before[key] ?? "").trim();
    const to = (after[key] ?? "").trim();
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Restituisce il dataEditToken del cliente, generandolo e persistendolo se non
 * esiste ancora (lazy: alla prima mail di benvenuto / richiesta admin / uso).
 */
export async function ensureDataEditToken(client: {
  id: string;
  dataEditToken: string | null;
}): Promise<string> {
  if (client.dataEditToken) return client.dataEditToken;
  const token = randomBytes(24).toString("hex");
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { dataEditToken: token },
    select: { dataEditToken: true },
  });
  return updated.dataEditToken!;
}
