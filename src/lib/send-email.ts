import "server-only";
import type {
  EmailLogType,
  EmailTrigger,
  NotificationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

export type SendResult = {
  /** Esito compatibile con NotificationLog (SKIPPED → INVIATA: era già partita). */
  status: NotificationStatus;
  ok: boolean;
  /** true se non inviata perché già presente un EmailLog SENT con la stessa dedupeKey. */
  skipped: boolean;
  resendId?: string;
  error?: string;
  /** id dell'EmailLog scritto (null se la scrittura del log è fallita). */
  logId: string | null;
};

/** Allegato email (es. lettera di benvenuto PDF). */
export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

/** Metadati registrati in EmailLog per ogni invio. */
export type EmailLogMeta = {
  type: EmailLogType;
  trigger: EmailTrigger;
  clientId?: string | null;
  subscriptionId?: string | null;
  dueDate?: Date | null;
  itemIds?: string[];
  /**
   * Chiave anti-doppio invio: se esiste già un EmailLog SENT con questa chiave
   * l'email NON viene inviata (log SKIPPED). Protezione aggiuntiva rispetto ai
   * controlli esistenti (NotificationLog, flag).
   */
  dedupeKey?: string | null;
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  /** Reinvio manuale: EmailLog originale. */
  resentFromId?: string | null;
};

/**
 * Client Resend. La chiave è letta a runtime: se manca, fallisce solo l'invio
 * (non la build). Questo è l'UNICO modulo che usa Resend.
 */
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY non configurata");
  return new Resend(key);
}

// ── Throttle + retry (rate limit Resend ~2 richieste/s) ────────────────────
// Intervallo minimo tra due invii nello stesso processo (~1,8/s).
const MIN_INTERVAL_MS = 550;
// Tentativi massimi per invio in caso di 429, con backoff esponenziale.
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;

let nextSlotAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attende il proprio turno: al massimo un invio ogni MIN_INTERVAL_MS. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

type TransportResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; rateLimited: boolean };

type Payload = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
};

/**
 * Trasporto di prova per i test locali (MAI in produzione): EMAIL_TEST_TRANSPORT
 * = "ok" (successo simulato), "fail" (errore), "fail:<testo>" (errore solo se
 * un destinatario contiene <testo>), "429" (rate limit).
 */
function testTransport(mode: string, p: Payload): TransportResult {
  if (mode === "429") {
    return { ok: false, error: "Too many requests (simulato)", rateLimited: true };
  }
  if (mode === "fail") {
    return { ok: false, error: "Errore Resend simulato", rateLimited: false };
  }
  if (mode.startsWith("fail:")) {
    const needle = mode.slice(5);
    if (p.to.some((t) => t.includes(needle))) {
      return { ok: false, error: "Errore Resend simulato", rateLimited: false };
    }
  }
  return { ok: true, id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
}

async function transport(p: Payload): Promise<TransportResult> {
  const testMode = process.env.EMAIL_TEST_TRANSPORT;
  if (testMode && process.env.NODE_ENV !== "production") {
    return testTransport(testMode, p);
  }
  try {
    const { data, error } = await getResend().emails.send({
      from: p.from,
      to: p.to,
      ...(p.cc.length > 0 ? { cc: p.cc } : {}),
      ...(p.bcc.length > 0 ? { bcc: p.bcc } : {}),
      ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      subject: p.subject,
      text: p.text,
      html: p.html,
      ...(p.attachments && p.attachments.length > 0
        ? { attachments: p.attachments }
        : {}),
    });
    if (error) {
      return {
        ok: false,
        error: error.message ?? String(error),
        rateLimited: error.name === "rate_limit_exceeded",
      };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message, rateLimited: /\b429\b|rate.?limit/i.test(message) };
  }
}

/** Invio con throttle e retry/backoff sui 429 (max MAX_ATTEMPTS tentativi). */
async function deliver(p: Payload): Promise<TransportResult> {
  let last: TransportResult = { ok: false, error: "nessun tentativo", rateLimited: false };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    last = await transport(p);
    if (last.ok || !last.rateLimited) return last;
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  if (!last.ok) {
    return { ...last, error: `${last.error} (dopo ${MAX_ATTEMPTS} tentativi)` };
  }
  return last;
}

/** Scrive l'EmailLog senza mai lanciare; in caso di collisione sulla chiave la omette. */
async function writeLog(
  data: Parameters<typeof prisma.emailLog.create>[0]["data"],
): Promise<string | null> {
  try {
    return (await prisma.emailLog.create({ data, select: { id: true } })).id;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002" && data.dedupeKey) {
      try {
        return (
          await prisma.emailLog.create({
            data: { ...data, dedupeKey: null },
            select: { id: true },
          })
        ).id;
      } catch {
        // cade nel log sotto
      }
    }
    console.error("[send-email] scrittura EmailLog fallita:", e);
    return null;
  }
}

/**
 * Punto UNICO di invio email (via Resend). Registra SEMPRE un EmailLog con il
 * contenuto completo: SENT (con resendId), FAILED (con errore) o SKIPPED
 * (dedupeKey già inviata).
 *
 * NON lancia mai: qualsiasi errore (config mancante, Resend down, 429 dopo i
 * tentativi, DB) viene restituito nel risultato, così un loop cron prosegue.
 * `to` assente → ADMIN_EMAIL.
 */
export async function sendEmail(
  content: {
    subject: string;
    text: string;
    html: string;
  },
  /** Uno o più destinatari; assente → ADMIN_EMAIL. */
  to: string | string[] | undefined,
  log: EmailLogMeta,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const recipients = (
    Array.isArray(to) ? to : [to ?? process.env.ADMIN_EMAIL ?? ""]
  )
    .map((r) => r.trim())
    .filter(Boolean);
  const recipient = recipients.length > 0 ? recipients.join(", ") : undefined;
  const from = process.env.EMAIL_FROM ?? "";
  const dedupeKey = log.dedupeKey ?? null;

  const base = {
    type: log.type,
    trigger: log.trigger,
    from,
    to: recipients,
    cc: log.cc ?? [],
    bcc: log.bcc ?? [],
    replyTo: log.replyTo ?? null,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachmentNames: (attachments ?? []).map((a) => a.filename),
    clientId: log.clientId ?? null,
    subscriptionId: log.subscriptionId ?? null,
    dueDate: log.dueDate ?? null,
    itemIds: log.itemIds ?? [],
    resentFromId: log.resentFromId ?? null,
  };

  // ── Anti-doppio invio su dedupeKey ─────────────────────────────────────────
  if (dedupeKey) {
    try {
      const existing = await prisma.emailLog.findUnique({
        where: { dedupeKey },
        select: { id: true, status: true, resendId: true },
      });
      if (existing?.status === "SENT") {
        const logId = await writeLog({
          ...base,
          status: "SKIPPED",
          errorMessage: `Duplicato: già inviata (EmailLog ${existing.id}, chiave ${dedupeKey})`,
        });
        return {
          status: "INVIATA",
          ok: true,
          skipped: true,
          resendId: existing.resendId ?? undefined,
          logId,
        };
      }
      // Tentativo precedente non riuscito: la chiave passa al nuovo tentativo.
      if (existing) {
        await prisma.emailLog.update({
          where: { id: existing.id },
          data: { dedupeKey: null },
        });
      }
    } catch (e) {
      console.error("[send-email] controllo dedupeKey fallito:", e);
    }
  }

  // ── Invio ──────────────────────────────────────────────────────────────────
  let result: TransportResult;
  if (!recipient || !from) {
    result = {
      ok: false,
      error: "Destinatario o EMAIL_FROM non configurato",
      rateLimited: false,
    };
  } else {
    result = await deliver({
      from,
      to: base.to,
      cc: base.cc,
      bcc: base.bcc,
      replyTo: base.replyTo,
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments,
    });
  }

  if (!result.ok) {
    console.error(
      `[send-email] invio ${log.type} a ${recipient ?? "(nessuno)"} fallito: ${result.error}`,
    );
  }

  const logId = await writeLog({
    ...base,
    status: result.ok ? "SENT" : "FAILED",
    resendId: result.ok ? (result.id ?? null) : null,
    errorMessage: result.ok ? null : result.error,
    dedupeKey,
  });

  return result.ok
    ? { status: "INVIATA", ok: true, skipped: false, resendId: result.id, logId }
    : { status: "FALLITA", ok: false, skipped: false, error: result.error, logId };
}

/**
 * Registra come FAILED un'email che NON è stata inviata per un motivo a monte
 * (es. link di pagamento non creato): resta visibile nel Log email con il
 * contenuto che sarebbe partito e l'errore. Nessun invio, nessuna dedupeKey.
 */
export async function logUnsentEmail(
  content: { subject: string; text: string; html: string },
  to: string,
  log: EmailLogMeta,
  error: string,
): Promise<string | null> {
  return writeLog({
    type: log.type,
    trigger: log.trigger,
    status: "FAILED",
    from: process.env.EMAIL_FROM ?? "",
    to: [to],
    cc: [],
    bcc: [],
    replyTo: null,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachmentNames: [],
    clientId: log.clientId ?? null,
    subscriptionId: log.subscriptionId ?? null,
    dueDate: log.dueDate ?? null,
    itemIds: log.itemIds ?? [],
    errorMessage: `Non inviata: ${error}`,
  });
}

/** Stati reinviabili: le email SKIPPED (duplicati) non si reinviano. */
export const RESENDABLE_STATUSES = ["SENT", "FAILED"] as const;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Indirizzi non validi tra quelli forniti (formato email). */
export function invalidEmails(addresses: string[]): string[] {
  return addresses.filter((a) => !EMAIL_RE.test(a.trim()));
}

export type ResendOutcome =
  | { kind: "not_found" }
  | { kind: "not_resendable"; status: string }
  | { kind: "invalid"; invalid: string[] }
  | { kind: "sent"; result: SendResult };

/**
 * Reinvia lo SNAPSHOT di un EmailLog (stesso oggetto, HTML e testo salvati,
 * nessun ricalcolo) ai destinatari scelti: nuovo EmailLog con trigger MANUAL,
 * senza dedupeKey, collegato all'originale (resentFromId). Gli allegati non
 * vengono reinviati (non conservati). Non modifica l'anagrafica.
 */
export async function resendEmailLog(
  id: string,
  recipients: string[],
): Promise<ResendOutcome> {
  const original = await prisma.emailLog.findUnique({ where: { id } });
  if (!original) return { kind: "not_found" };
  if (!(RESENDABLE_STATUSES as readonly string[]).includes(original.status)) {
    return { kind: "not_resendable", status: original.status };
  }
  const to = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  const invalid = to.length === 0 ? ["(nessun destinatario)"] : invalidEmails(to);
  if (invalid.length > 0) return { kind: "invalid", invalid };

  const result = await sendEmail(
    { subject: original.subject, text: original.text ?? "", html: original.html },
    to,
    {
      type: original.type,
      trigger: "MANUAL",
      clientId: original.clientId,
      subscriptionId: original.subscriptionId,
      dueDate: original.dueDate,
      itemIds: original.itemIds,
      cc: original.cc,
      bcc: original.bcc,
      replyTo: original.replyTo,
      resentFromId: original.id,
    },
  );
  return { kind: "sent", result };
}
