import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withEndClient } from "@/lib/end-client";

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

/** Riepilogo leggibile di una riga per i dettagli dei cron (anteprima, storico). */
export function itemSummary(it: {
  id: string;
  subscriptionId: string;
  quantity: number;
  endDate: Date;
  endClientName: string | null;
  service: { name: string };
  subscription: { client: { name: string; ragioneSociale: string | null } };
}) {
  return {
    itemId: it.id,
    subscriptionId: it.subscriptionId,
    client: clientDisplayName(it.subscription.client),
    services: withEndClient(serviceLabel(it), it.endClientName),
    dueDate: ymd(it.endDate),
  };
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

/** Durata massima del lock di esecuzione: oltre è considerato abbandonato. */
export const CRON_LOCK_TTL_MS = 15 * 60 * 1000;

export type CronExecOptions = {
  trigger: "CRON" | "MANUAL";
  /** Email dell'utente (esecuzioni manuali). */
  triggeredBy?: string | null;
  /** Esecuzione manuale esplicita: procede anche se il cron è in pausa. */
  ignorePause?: boolean;
};

export type CronExecOutcome =
  | { kind: "paused"; runId: string | null }
  | { kind: "locked"; runId: string | null; message: string }
  | { kind: "done"; runId: string | null; result: CronResult };

/** Interruttore del cron (riga creata attiva se mancante). */
export async function getCronSetting(name: CronName) {
  return prisma.cronSetting.upsert({
    where: { name },
    create: { name, enabled: true },
    update: {},
  });
}

/**
 * Acquisisce il lock del cron in modo atomico (UPDATE condizionato): riesce
 * solo se nessuno lo detiene o se è scaduto (> 15 min). Controlla anche che non
 * ci sia un CronRun in corso iniziato da meno di 15 minuti.
 */
async function acquireCronLock(name: CronName, owner: string, now: Date): Promise<Date | null> {
  await getCronSetting(name);
  const staleBefore = new Date(now.getTime() - CRON_LOCK_TTL_MS);
  const lockedAt = new Date(now);
  const res = await prisma.cronSetting.updateMany({
    where: { name, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    data: { lockedAt, lockedBy: owner },
  });
  if (res.count !== 1) return null;
  const running = await prisma.cronRun.findFirst({
    where: { name, finishedAt: null, status: "RUNNING", startedAt: { gt: staleBefore } },
    select: { id: true },
  });
  if (running) {
    await releaseCronLock(name, lockedAt);
    return null;
  }
  return lockedAt;
}

async function releaseCronLock(name: CronName, lockedAt: Date): Promise<void> {
  await prisma.cronSetting
    .updateMany({ where: { name, lockedAt }, data: { lockedAt: null, lockedBy: null } })
    .catch((e) => console.error(`[cron ${name}] rilascio lock fallito:`, e));
}

/**
 * Esegue un cron REALE: rispetta la pausa (CronSetting), impedisce esecuzioni
 * concorrenti (lock in DB) e registra tutto in CronRun (stato, trigger, utente,
 * conteggi, errore). Un'eccezione del cron viene registrata e rilanciata.
 */
export async function executeCron(
  name: CronName,
  fn: () => Promise<CronResult>,
  opts: CronExecOptions,
): Promise<CronExecOutcome> {
  const now = new Date();
  const base = { name, trigger: opts.trigger, triggeredBy: opts.triggeredBy ?? null };

  const setting = await getCronSetting(name);
  if (!setting.enabled && !opts.ignorePause) {
    const run = await prisma.cronRun
      .create({ data: { ...base, status: "PAUSED", finishedAt: now }, select: { id: true } })
      .catch(() => null);
    return { kind: "paused", runId: run?.id ?? null };
  }

  const owner = opts.triggeredBy ?? opts.trigger;
  const lockedAt = await acquireCronLock(name, owner, now);
  if (!lockedAt) {
    const message = "Esecuzione bloccata: lo stesso cron è già in corso.";
    const run = await prisma.cronRun
      .create({
        data: { ...base, status: "FAILED", finishedAt: now, error: message },
        select: { id: true },
      })
      .catch(() => null);
    return { kind: "locked", runId: run?.id ?? null, message };
  }

  let runId: string | null = null;
  try {
    runId = (await prisma.cronRun.create({ data: { ...base, status: "RUNNING" }, select: { id: true } })).id;
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
            status: "SUCCESS",
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
    return { kind: "done", runId, result };
  } catch (e) {
    if (runId) {
      await prisma.cronRun
        .update({
          where: { id: runId },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: e instanceof Error ? (e.stack ?? e.message) : String(e),
          },
        })
        .catch(() => undefined);
    }
    throw e;
  } finally {
    await releaseCronLock(name, lockedAt);
  }
}

/** Handler GET comune: auth, dry-run (anche in pausa), pausa, lock, JSON. */
export async function handleCronRequest(
  request: NextRequest,
  name: CronName,
  run: (opts: { now: Date; dryRun: boolean }) => Promise<CronResult>,
): Promise<NextResponse> {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  const dryRun = isDryRun(request);
  try {
    if (dryRun) return NextResponse.json(await run({ now: new Date(), dryRun: true }));
    const outcome = await executeCron(name, () => run({ now: new Date(), dryRun: false }), {
      trigger: "CRON",
    });
    if (outcome.kind === "paused") return NextResponse.json({ paused: true });
    if (outcome.kind === "locked") {
      return NextResponse.json({ locked: true, error: outcome.message }, { status: 409 });
    }
    return NextResponse.json(outcome.result);
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
