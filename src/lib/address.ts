// UNICO punto di composizione dell'indirizzo (ricevuta, email, admin). Le parti
// inserite a mano spesso finiscono con una virgola ("Via Treviso 33,"): unite
// con ", " darebbero "Via Treviso 33,, 00161".

/** Parte di indirizzo senza spazi né virgole iniziali/finali ("" se vuota). */
export function cleanAddressPart(part: string | null | undefined): string {
  return (part ?? "").replace(/^[\s,]+|[\s,]+$/g, "");
}

/** Unisce con ", " le parti non vuote, ripulite. null se non resta nulla. */
export function formatAddress(parts: (string | null | undefined)[]): string | null {
  const clean = parts.map(cleanAddressPart).filter(Boolean);
  return clean.length ? clean.join(", ") : null;
}

/**
 * Indirizzo completo del cliente in una riga, saltando i campi vuoti.
 * Es. "Via Roma 1, 20100 Milano (MI), IT".
 */
export function formatClientAddress(client: {
  indirizzo: string | null;
  cap: string | null;
  citta: string | null;
  provincia: string | null;
  paese: string | null;
}): string | null {
  const provincia = cleanAddressPart(client.provincia);
  const cityLine = [
    cleanAddressPart(client.cap),
    cleanAddressPart(client.citta),
    provincia ? `(${provincia})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return formatAddress([client.indirizzo, cityLine, client.paese]);
}

/**
 * Ripulisce un indirizzo già composto (snapshot salvati prima di
 * formatAddress, es. ricevute emesse): "Via Treviso 33,, 00161" → "Via
 * Treviso 33, 00161".
 */
export function normalizeAddress(address: string | null | undefined): string | null {
  return address ? formatAddress(address.split(",")) : null;
}
