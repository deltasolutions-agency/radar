import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth";
import type { SessionPayload } from "@/lib/session";

/**
 * Helper condivisi per le API routes: protezione sessione, risposte JSON
 * coerenti e formattazione degli errori di validazione Zod.
 */

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status: number, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status });
}

/** Errore sentinella lanciato quando manca la sessione. */
export class UnauthorizedError extends Error {}

/**
 * Richiede una sessione admin valida. Le API non passano dal middleware
 * (escluse dal matcher), quindi la verifica avviene qui.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/** Formatta gli errori Zod in { campo: messaggio }. */
function formatZod(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Esegue un handler gestendo in modo uniforme: 401 (sessione), 400
 * (validazione Zod) e 500 (imprevisti).
 */
export async function withApi(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return error("Non autenticato", 401);
    }
    if (e instanceof ZodError) {
      return error("Dati non validi", 400, formatZod(e));
    }
    console.error("[api] errore non gestito:", e);
    return error("Errore interno", 500);
  }
}
