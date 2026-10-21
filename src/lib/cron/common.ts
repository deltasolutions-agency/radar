import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Nomi dei cron registrati in CronRun. */
export const CRON_NAMES = {
  reminders: "reminders",
  autoCharge: "auto-charge",
  activationReminders: "autocharge-reminders",
} as const;
export type CronName = (typeof CRON_NAMES)[keyof typeof CRON_NAMES];

/** Esito uniforme di ogni cron (anche in dry-run). */
export type CronResult = {
  dryRun: boolean;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  details: Record<string, unknown>[];
  [extra: string]: unknown;
};

/** Data YYYY-MM-DD di una scadenza (endDate è sempre mezzanotte UTC). */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hash breve e deterministico di un insieme di id (ordine indifferente). */
export function idsHash(ids: string[]): string {
  return createHash("sha256")
    .update([...ids].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}

/** Nome cliente mostrato nelle email: ragione sociale se presente. */
export function clientDisplayName(client: {
  ragioneSociale: string | null;
  name: string;
}): string {
  return client.ragioneSociale?.trim() ? client.ragioneSociale : client.name;
}

/** Nome servizio con quantità (es. "Caselle email ×3"). */
export function serviceLabel(it: {
  quantity: number;
  service: { name: string };
}): string {
  return it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name;
}

/** Bearer CRON_SECRET: null se autorizzato, altrimenti la risposta 401. */
export function cronUnauthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  return null;
}

/** ?dryRun=1 (o true): stessa logica, nessun invio/addebito/scrittura. */
export function isDryRun(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get("dryRun");
  return v === "1" || v === "true";
}

/**
 * Esegue un cron REALE registrandolo in CronRun (inizio, fine, conteggi,
 * errore). Un'eccezione viene registrata e rilanciata.
 */
export async function recordCronRun(
  name: CronName,
  fn: () => Promise<CronResult>,
): Promise<CronResult> {
  let runId: string | null = null;
  try {
    runId = (await prisma.cronRun.create({ data: { name }, select: { id: true } })).id;
  } catch (e) {
    console.error(`[cron ${name}] registrazione CronRun fallita:`, e);
  }
  try {
    const result = await fn();
    if (runId) {
      await prisma.cronRun
        .update({
          where: { id: runId },
          data: {
            finishedAt: new Date(),
            candidates: result.candidates,
            sent: result.sent,
            skipped: result.skipped,
            failed: result.failed,
            details: JSON.parse(JSON.stringify(result.details)) as Prisma.InputJsonValue,
          },
        })
        .catch((e) => console.error(`[cron ${name}] chiusura CronRun fallita:`, e));
    }
    return result;
  } catch (e) {
    if (runId) {
      await prisma.cronRun
        .update({
          where: { id: runId },
          data: {
            finishedAt: new Date(),
            error: e instanceof Error ? (e.stack ?? e.message) : String(e),
          },
        })
        .catch(() => undefined);
    }
    throw e;
  }
}

/** Handler GET comune: auth, dry-run, CronRun, risposta JSON. */
export async function handleCronRequest(
  request: NextRequest,
  name: CronName,
  run: (opts: { now: Date; dryRun: boolean }) => Promise<CronResult>,
): Promise<NextResponse> {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  const now = new Date();
  const dryRun = isDryRun(request);
  try {
    const result = dryRun
      ? await run({ now, dryRun: true })
      : await recordCronRun(name, () => run({ now, dryRun: false }));
    return NextResponse.json(result);
  } catch (e) {
    console.error(`[cron ${name}] errore:`, e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        dryRun,
        candidates: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        details: [],
      },
      { status: 500 },
    );
  }
}
