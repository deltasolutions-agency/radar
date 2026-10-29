import "server-only";
import { prisma } from "@/lib/prisma";
import { buildCronSummaryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { formatEur } from "@/lib/format";
import { romeYmd } from "@/lib/rome-time";
import type { CronResult } from "@/lib/cron/common";
import {
  LEDGER_ALERT_RECIPIENT,
  LEDGER_ALERT_REPEAT_DAYS,
  LEDGER_TEXT,
  dayFromYmd,
  daysLate,
  formatDay,
  needsLedgerAlert,
  ymdOfDay,
  type LedgerKindValue,
} from "@/lib/ledger";

// Cron "ledger-alerts" — Amministrazione. Indipendente da abbonamenti e
// pagamenti: legge solo LedgerEntry. Una mail di riepilogo al giorno a
// hello@deltasolutions.agency quando almeno una voce aperta e scaduta è da
// avvisare (il giorno dopo la scadenza, poi ogni LEDGER_ALERT_REPEAT_DAYS
// giorni). La mail elenca TUTTE le voci scadute, segnando quelle nuove.

type Entry = Awaited<ReturnType<typeof loadOverdue>>[number];

function loadOverdue(todayYmd: string) {
  return prisma.ledgerEntry.findMany({
    where: { paidAt: null, dueDate: { lt: dayFromYmd(todayYmd) } },
    orderBy: [{ kind: "asc" }, { dueDate: "asc" }],
  });
}

function entryLine(e: Entry, today: string, isDue: boolean): string {
  const late = daysLate(e.dueDate, today);
  const parts = [
    e.counterparty,
    e.description,
    formatEur(e.amountCents, e.currency),
    `scaduto il ${formatDay(e.dueDate)} (${late} ${late === 1 ? "giorno" : "giorni"} fa)`,
  ].filter(Boolean);
  const tag = isDue ? (e.alertCount === 0 ? " [nuovo]" : ` [richiamo n. ${e.alertCount + 1}]`) : "";
  return `${parts.join(" — ")}${tag}`;
}

function detail(e: Entry, today: string, outcome: string, extra: Record<string, unknown> = {}) {
  const late = daysLate(e.dueDate, today);
  return {
    outcome,
    entryId: e.id,
    client: e.counterparty,
    services: `${LEDGER_TEXT[e.kind].tab}${e.description ? ` · ${e.description}` : ""}`,
    dueDate: ymdOfDay(e.dueDate),
    totalCents: e.amountCents,
    note:
      outcome === "SKIPPED"
        ? `scaduto da ${late} gg · ultimo alert ${formatDay(e.lastAlertAt ? romeYmd(e.lastAlertAt) : null)}`
        : `scaduto da ${late} gg${e.alertCount > 0 ? ` · richiamo n. ${e.alertCount + 1}` : ""}`,
    ...extra,
  };
}

export async function runLedgerAlerts({
  now,
  dryRun,
}: {
  now: Date;
  dryRun: boolean;
}): Promise<CronResult> {
  const today = romeYmd(now);
  const overdue = await loadOverdue(today);
  const due = overdue.filter((e) =>
    needsLedgerAlert(e, today, e.lastAlertAt ? romeYmd(e.lastAlertAt) : null),
  );
  const dueIds = new Set(due.map((e) => e.id));
  const skipped = overdue.filter((e) => !dueIds.has(e.id));
  const skippedDetails = skipped.map((e) => detail(e, today, "SKIPPED"));

  if (due.length === 0) {
    return { dryRun, candidates: overdue.length, sent: 0, skipped: skipped.length, failed: 0, details: skippedDetails };
  }

  if (dryRun) {
    return {
      dryRun,
      candidates: overdue.length,
      sent: 0,
      skipped: skipped.length,
      failed: 0,
      wouldSend: 1,
      details: [
        ...due.map((e) => detail(e, today, "WOULD_SEND", { recipient: LEDGER_ALERT_RECIPIENT })),
        ...skippedDetails,
      ],
    };
  }

  const appUrl = process.env.APP_URL ?? "";
  const byKind = (k: LedgerKindValue) => overdue.filter((e) => e.kind === k);
  const total = (k: LedgerKindValue) => byKind(k).reduce((s, e) => s + e.amountCents, 0);
  const credits = byKind("CREDITO");
  const debts = byKind("DEBITO");
  const subjectParts = [
    credits.length > 0 ? `${credits.length} da incassare (${formatEur(total("CREDITO"))})` : null,
    debts.length > 0 ? `${debts.length} da pagare (${formatEur(total("DEBITO"))})` : null,
  ].filter(Boolean);

  const content = buildCronSummaryEmail({
    subject: `[Radar] Scadenze superate: ${subjectParts.join(", ")}`,
    title: "Amministrazione: scadenze superate",
    intro: `Ci sono voci aperte oltre la scadenza. Quelle segnate [nuovo] o [richiamo] hanno fatto partire questo avviso; le altre sono già state segnalate negli ultimi ${LEDGER_ALERT_REPEAT_DAYS} giorni. Il richiamo si ripete ogni ${LEDGER_ALERT_REPEAT_DAYS} giorni finché non segni la voce come incassata o pagata.`,
    sections: [
      {
        heading: `${LEDGER_TEXT.CREDITO.alertHeading} — totale ${formatEur(total("CREDITO"))}`,
        lines: credits.map((e) => entryLine(e, today, dueIds.has(e.id))),
      },
      {
        heading: `${LEDGER_TEXT.DEBITO.alertHeading} — totale ${formatEur(total("DEBITO"))}`,
        lines: debts.map((e) => entryLine(e, today, dueIds.has(e.id))),
      },
      {
        heading: "Apri in Radar",
        lines: [
          credits.length > 0 ? `Incassi: ${appUrl}/amministrazione/incassi?stato=scaduti` : "",
          debts.length > 0 ? `Dovuto: ${appUrl}/amministrazione/dovuto?stato=scaduti` : "",
        ].filter(Boolean),
      },
    ],
  });

  const res = await sendEmail(content, LEDGER_ALERT_RECIPIENT, {
    type: "LEDGER_OVERDUE_ALERT",
    trigger: "CRON",
    // Al massimo un riepilogo al giorno, anche con più esecuzioni.
    dedupeKey: `ledger-alert:${today}`,
  });

  if (!res.ok) {
    return {
      dryRun,
      candidates: overdue.length,
      sent: 0,
      skipped: skipped.length,
      failed: due.length,
      details: [
        ...due.map((e) => detail(e, today, "FAILED", { error: res.error ?? "invio non riuscito" })),
        ...skippedDetails,
      ],
    };
  }

  // Riepilogo di oggi già partito (es. "Esegui ora" dopo il cron): nessun
  // conteggio da aggiornare, le voci nuove partono domani.
  if (res.skipped) {
    return {
      dryRun,
      candidates: overdue.length,
      sent: 0,
      skipped: overdue.length,
      failed: 0,
      details: overdue.map((e) =>
        detail(e, today, "SKIPPED", { note: "riepilogo di oggi già inviato" }),
      ),
    };
  }

  await prisma.$transaction(
    due.map((e) =>
      prisma.ledgerEntry.update({
        where: { id: e.id },
        data: { lastAlertAt: now, alertCount: { increment: 1 } },
      }),
    ),
  );

  return {
    dryRun,
    candidates: overdue.length,
    sent: 1,
    skipped: skipped.length,
    failed: 0,
    details: [
      ...due.map((e) => detail(e, today, "SENT", { recipient: LEDGER_ALERT_RECIPIENT })),
      ...skippedDetails,
    ],
  };
}
