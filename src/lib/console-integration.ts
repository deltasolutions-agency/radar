import "server-only";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

/**
 * Integrazione con la console Delta Cloud (server-to-server).
 *
 * La console firma ogni richiesta con HMAC-SHA256 e il segreto condiviso
 * CONSOLE_INTEGRATION_SECRET (≥ 32 caratteri, stesso valore di RADAR_SECRET
 * nella console). Header:  X-Console-Signature: t=<unix>,v1=<hex>
 * Messaggio firmato:       `${t}.${METHOD}.${pathname+search}.${body}`
 * Le richieste più vecchie di 5 minuti vengono rifiutate.
 *
 * Queste rotte non usano la sessione staff: sono pensate solo per la console.
 */

const MAX_SKEW_S = 300;

export class IntegrationAuthError extends Error {}

function secret(): string {
  const s = process.env.CONSOLE_INTEGRATION_SECRET ?? "";
  if (s.length < 32) throw new IntegrationAuthError("Integrazione console non configurata");
  return s;
}

export function verifyConsoleRequest(req: NextRequest, body: string): void {
  const header = req.headers.get("x-console-signature") ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!t || !/^[0-9a-f]{64}$/.test(v1)) throw new IntegrationAuthError("Firma mancante");
  if (Math.abs(Date.now() / 1000 - t) > MAX_SKEW_S) throw new IntegrationAuthError("Firma scaduta");
  const url = new URL(req.url);
  const msg = `${t}.${req.method}.${url.pathname}${url.search}.${body}`;
  const expected = crypto.createHmac("sha256", secret()).update(msg).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new IntegrationAuthError("Firma non valida");
}

/** Esegue l'handler dopo aver verificato la firma; risposte JSON uniformi. */
export async function withConsole(
  req: NextRequest,
  handler: (body: unknown) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const raw = req.method === "GET" ? "" : await req.text();
    verifyConsoleRequest(req, raw);
    const body = raw ? JSON.parse(raw) : null;
    return await handler(body);
  } catch (e) {
    if (e instanceof IntegrationAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ZodError) return NextResponse.json({ error: "Dati non validi", details: e.flatten() }, { status: 400 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    console.error("[integrations/console]", e);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
