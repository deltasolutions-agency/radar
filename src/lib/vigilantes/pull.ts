import "server-only";
import { randomUUID } from "node:crypto";
import type { EmailTrigger, WpSite } from "@prisma/client";
import { ingestReport, recordCheckResult } from "@/lib/vigilantes/ingest";
import {
  PLUGIN_REST_ROUTE,
  pluginStatusUrl,
  reportSchema,
  signedHeaders,
} from "@/lib/vigilantes/protocol";

const TIMEOUT_MS = 45_000;

/** Impostazioni che Radar comunica al plugin a ogni contatto (pull e risposta al push). */
export function siteOptions(site: Pick<WpSite, "deepScan">) {
  return { deep_scan: site.deepScan };
}

type Failure = { ok: false; kind: "SITE_UNREACHABLE" | "AGENT_ERROR"; error: string };
type FetchOutcome = { ok: true; body: unknown } | Failure;

/**
 * Chiamata firmata all'endpoint del plugin. POST (mai in cache: LiteSpeed e
 * Cloudflare possono mettere in cache le GET della REST API) e redirect non
 * seguiti (una POST rediretta diventa GET: meglio segnalarlo).
 */
async function callPlugin(site: WpSite): Promise<FetchOutcome> {
  const body = JSON.stringify({ nonce: randomUUID(), refresh: true, options: siteOptions(site) });
  let res: Response;
  try {
    res = await fetch(pluginStatusUrl(site.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Radar-Vigilantes/1 (+https://radar.deltasolutions.agency)",
        ...signedHeaders(site.id, site.secret, "POST", PLUGIN_REST_ROUTE, body),
      },
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const cause = e instanceof Error ? ((e.cause as { code?: string } | undefined)?.code ?? e.message) : String(e);
    const msg = /timeout|abort/i.test(String(cause)) ? `nessuna risposta entro ${TIMEOUT_MS / 1000}s` : String(cause);
    return { ok: false, kind: "SITE_UNREACHABLE", error: msg };
  }

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "?";
    return {
      ok: false,
      kind: "AGENT_ERROR",
      error: `il sito reindirizza a ${loc}: aggiorna l'URL del sito in Radar`,
    };
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non JSON */
  }
  if (res.status >= 500) {
    return { ok: false, kind: "SITE_UNREACHABLE", error: `errore del server HTTP ${res.status}` };
  }
  if (!res.ok) {
    const code = (data as { code?: string; message?: string } | null)?.code;
    const message = (data as { message?: string } | null)?.message;
    if (code === "rest_no_route") {
      return { ok: false, kind: "AGENT_ERROR", error: "plugin non installato o disattivato" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        kind: "AGENT_ERROR",
        error: data
          ? `firma rifiutata (${message ?? code ?? res.status}): controlla la chiave nel plugin`
          : `accesso negato HTTP ${res.status} (firewall o WAF?)`,
      };
    }
    return { ok: false, kind: "AGENT_ERROR", error: `HTTP ${res.status}${message ? `: ${message}` : ""}` };
  }
  if (!data) return { ok: false, kind: "AGENT_ERROR", error: "risposta non valida (non JSON)" };
  return { ok: true, body: data };
}

export type CheckResult =
  | { ok: true; updates: number; critical: number }
  | { ok: false; kind: Failure["kind"]; error: string };

/**
 * Controllo completo di un sito: chiama il plugin (con un nuovo tentativo
 * opzionale), registra il report e lo stato di raggiungibilità.
 */
export async function checkSite(
  site: WpSite,
  opts: { retry: boolean; trigger: EmailTrigger },
): Promise<CheckResult> {
  let out = await callPlugin(site);
  if (!out.ok && opts.retry) {
    await new Promise((r) => setTimeout(r, 10_000));
    out = await callPlugin(site);
  }
  if (!out.ok) {
    await recordCheckResult(site, out, opts.trigger);
    return out;
  }
  const raw = (out.body as { report?: unknown }).report ?? out.body;
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const failure: Failure = {
      ok: false,
      kind: "AGENT_ERROR",
      error: `report non valido (${parsed.error.issues[0]?.path.join(".") || "?"}: ${parsed.error.issues[0]?.message ?? ""})`,
    };
    await recordCheckResult(site, failure, opts.trigger);
    return failure;
  }
  await recordCheckResult(site, { ok: true }, opts.trigger);
  const ing = await ingestReport(site, parsed.data, "PULL", opts.trigger);
  return { ok: true, updates: ing.updates, critical: ing.opened.filter((a) => a.severity === "CRITICAL").length };
}
