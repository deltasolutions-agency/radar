// Vigilantes — protocollo tra Radar e il plugin WordPress "Radar Vigilantes".
//
// Firma (identica nelle due direzioni, vedi includes/class-rv-signer.php):
//   X-Radar-Site:      id del sito in Radar
//   X-Radar-Timestamp: secondi Unix
//   X-Radar-Signature: hex(HMAC-SHA256(secret, `${ts}\n${METHOD}\n${route}\n${body}`))
// `route` è la rotta logica, non l'URL: "/radar-vigilantes/v1/status" per le
// chiamate Radar → sito, "/api/vigilantes/ingest" per quelle sito → Radar.
// Finestra di validità: ±5 minuti.
//
// Chiave di collegamento (incollata nel plugin): "rv1." + base64url(JSON {u,i,s})
// con u = URL di Radar, i = id sito, s = secret.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const PLUGIN_SLUG = "radar-vigilantes";
export const PLUGIN_REST_ROUTE = "/radar-vigilantes/v1/status";
export const INGEST_ROUTE = "/api/vigilantes/ingest";
export const SIGNATURE_TOLERANCE_S = 300;

export const HEADER_SITE = "x-radar-site";
export const HEADER_TS = "x-radar-timestamp";
export const HEADER_SIG = "x-radar-signature";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signatureBase(ts: string, method: string, route: string, body: string): string {
  return `${ts}\n${method.toUpperCase()}\n${route}\n${body}`;
}

export function sign(secret: string, ts: string, method: string, route: string, body: string): string {
  return createHmac("sha256", secret).update(signatureBase(ts, method, route, body)).digest("hex");
}

/** Intestazioni firmate per una richiesta. */
export function signedHeaders(
  siteId: string,
  secret: string,
  method: string,
  route: string,
  body: string,
  now: Date = new Date(),
): Record<string, string> {
  const ts = String(Math.floor(now.getTime() / 1000));
  return {
    "X-Radar-Site": siteId,
    "X-Radar-Timestamp": ts,
    "X-Radar-Signature": sign(secret, ts, method, route, body),
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySignature(opts: {
  secret: string;
  ts: string | null;
  signature: string | null;
  method: string;
  route: string;
  body: string;
  now?: Date;
}): VerifyResult {
  const { ts, signature } = opts;
  if (!ts || !signature) return { ok: false, reason: "firma mancante" };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: "timestamp non valido" };
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowS - Number(ts)) > SIGNATURE_TOLERANCE_S) {
    return { ok: false, reason: "timestamp fuori finestra (orologio del server sfasato?)" };
  }
  if (!/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: "firma non valida" };
  const expected = Buffer.from(sign(opts.secret, ts, opts.method, opts.route, opts.body), "hex");
  const got = Buffer.from(signature.toLowerCase(), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "firma non valida" };
  }
  return { ok: true };
}

export function buildConnectionKey(radarUrl: string, siteId: string, secret: string): string {
  const json = JSON.stringify({ u: radarUrl.replace(/\/+$/, ""), i: siteId, s: secret });
  return `rv1.${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function parseConnectionKey(key: string): { u: string; i: string; s: string } | null {
  const m = /^rv1\.([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return null;
  try {
    const v = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    if (typeof v?.u === "string" && typeof v?.i === "string" && typeof v?.s === "string") return v;
  } catch {
    /* chiave malformata */
  }
  return null;
}

/** Impronta breve del secret, da mostrare in UI senza rivelarlo. */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/**
 * URL del sito normalizzato: schema + host in minuscolo, nessuno slash finale,
 * niente query/frammento. null se non è un URL http(s) valido.
 */
export function normalizeSiteUrl(input: string): string | null {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/** URL dell'endpoint del plugin: ?rest_route= funziona anche senza permalink. */
export function pluginStatusUrl(siteUrl: string): string {
  return `${siteUrl}/?rest_route=${PLUGIN_REST_ROUTE}`;
}

// ── Report inviato dal plugin (schema 1) ───────────────────────────────────
// Schema volutamente tollerante: campi mancanti o in più non bloccano
// l'ingestione (versioni diverse del plugin convivono).

const str = z.string().max(500);
const optStr = z.union([z.string().max(500), z.null()]).optional();
const bool = z.boolean().optional();

const updateSchema = z
  .object({ version: z.union([z.string(), z.number()]).transform(String) })
  .passthrough()
  .nullable()
  .optional();

const fileList = z.array(z.string().max(500)).max(500).optional();

export const reportSchema = z
  .object({
    schema: z.number().int(),
    plugin_version: str,
    generated_at: z.number().optional(),
    site: z
      .object({
        home_url: optStr,
        site_url: optStr,
        name: optStr,
        multisite: bool,
        locale: optStr,
        timezone: optStr,
      })
      .passthrough()
      .optional(),
    core: z.object({ version: str, update: updateSchema }).passthrough(),
    env: z
      .object({
        php: optStr,
        mysql: optStr,
        server: optStr,
        https: bool,
        debug: bool,
        debug_display: bool,
        memory_limit: optStr,
        disallow_file_edit: bool,
        disallow_file_mods: bool,
        wp_cron_disabled: bool,
        auto_update_core: optStr,
      })
      .passthrough()
      .optional(),
    plugins: z
      .array(
        z
          .object({
            slug: str,
            name: str,
            version: optStr,
            active: bool,
            network_active: bool,
            auto_update: bool,
            update: updateSchema,
          })
          .passthrough(),
      )
      .max(1000)
      .default([]),
    themes: z
      .array(
        z
          .object({
            slug: str,
            name: str,
            version: optStr,
            active: bool,
            parent: optStr,
            auto_update: bool,
            update: updateSchema,
          })
          .passthrough(),
      )
      .max(500)
      .default([]),
    translations_updates: z.number().int().optional(),
    admins: z
      .array(
        z
          .object({
            id: z.number().int(),
            login: str,
            email: optStr,
            registered: optStr,
          })
          .passthrough(),
      )
      .max(500)
      .optional(),
    agent: z
      .object({
        loader: bool,
        via_loader: bool,
        active_in_admin: bool,
        deactivated_by: optStr,
        deactivated_at: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
    security: z
      .object({
        integrity: z
          .object({
            checked_at: z.number().nullable().optional(),
            ok: z.boolean().nullable().optional(),
            modified: fileList,
            missing: fileList,
            unknown: fileList,
            error: optStr,
          })
          .passthrough()
          .optional(),
        uploads_php: z
          .object({
            checked_at: z.number().nullable().optional(),
            files: fileList,
            truncated: bool,
          })
          .passthrough()
          .optional(),
        plugin_integrity: z
          .object({
            checked_at: z.number().nullable().optional(),
            checked: z.number().int().optional(),
            skipped: z.number().int().optional(),
            plugins: z
              .array(
                z
                  .object({
                    slug: str,
                    name: optStr,
                    version: optStr,
                    modified: fileList,
                    unknown: fileList,
                  })
                  .passthrough(),
              )
              .max(200)
              .optional(),
            error: optStr,
          })
          .passthrough()
          .optional(),
        malware: z
          .object({
            checked_at: z.number().nullable().optional(),
            complete: bool,
            scanned: z.number().int().optional(),
            truncated: bool,
            findings: z
              .array(
                z
                  .object({
                    file: str,
                    rule: str,
                    label: optStr,
                    severity: z.enum(["high", "medium", "low"]).catch("medium"),
                    line: z.number().int().nullable().optional(),
                    excerpt: optStr,
                  })
                  .passthrough(),
              )
              .max(200)
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type VigilantesReport = z.infer<typeof reportSchema>;

/** Corpo del push dal plugin. */
export const pushSchema = z.object({
  event: z.string().max(100),
  events: z.array(z.record(z.unknown())).max(50).optional(),
  report: reportSchema,
});
