import "server-only";
import { prisma } from "@/lib/prisma";
import { buildCronSummaryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/send-email";
import { formatEur } from "@/lib/format";
import { romeYmd } from "@/lib/rome-time";
import type { CronResult } from "@/lib/cron/common";
import {
  COST_ALERT_DAYS,
  COST_ALERT_RECIPIENT,
  dayFromYmd,
  daysUntil,
  nextRenewalYmd,
  periodLabel,
  vatLabel,
} from "@/lib/costs";

// Cron "cost-renewals" — Amministrazione → Costi. Ogni giorno (alle 10:00):
// 1. i costi RICORRENTI con data di rinnovo già passata vengono spostati avanti
//    di un periodo (o più, se il cron è stato fermo);
// 2. se ci sono costi in uso che si rinnovano entro COST_ALERT_DAYS giorni
//    (o non ricorrenti già scaduti e non aggiornati), parte UNA mail a hello@
//    con l'elenco. Si ripete ogni giorno finché la scadenza non cambia:
//    il ricorrente esce dall'elenco quando la data passa e si rinnova da sola,
//    gli altri quando aggiorni la data o li segni come dismessi.

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dd = (y: string) => y.split("-").reverse().join("/");

function whenLabel(days: number): string {
  if (days === 0) return "scade oggi";
  if (days === 1) return "scade domani";
  if (days > 1) return `scade tra ${days} giorni`;
  return `scaduto da ${-days} ${days === -1 ? "giorno" : "giorni"}`;
}

export async function runCostRenewals({ now, dryRun }: { now: Date; dryRun: boolean }): Promise<CronResult> {
  const today = romeYmd(now);
  const details: Record<string, unknown>[] = [];

  // 1. Rinnovo automatico delle date dei costi ricorrenti.
  const toAdvance = await prisma.cost.findMany({
    where: { active: true, recurring: true, renewalDate: { lt: dayFromYmd(today) } },
    select: { id: true, name: true, supplier: true, renewalDate: true, periodMonths: true },
  });
  for (const c of toAdvance) {
    const from = ymd(c.renewalDate!);
    const to = nextRenewalYmd(from, c.periodMonths, today);
    if (!dryRun) await prisma.cost.update({ where: { id: c.id }, data: { renewalDate: dayFromYmd(to) } });
    details.push({
      outcome: dryRun ? "WOULD_RENEW" : "RENEWED",
      client: c.name,
      services: c.supplier ?? "",
      dueDate: to,
      note: `rinnovo automatico: ${dd(from)} → ${dd(to)}`,
    });
  }

  // 2. Avviso: costi in uso con rinnovo entro COST_ALERT_DAYS giorni (compresi
  //    i non ricorrenti già scaduti, finché non li aggiorni).
  const limit = dayFromYmd(today);
  limit.setUTCDate(limit.getUTCDate() + COST_ALERT_DAYS);
  const upcoming = (
    await prisma.cost.findMany({
      where: { active: true, renewalDate: { not: null, lte: limit } },
      orderBy: { renewalDate: "asc" },
    })
  ).map((c) => {
    // In dry-run i ricorrenti non sono stati spostati: usa la data che avrebbero.
    const date = c.recurring ? nextRenewalYmd(ymd(c.renewalDate!), c.periodMonths, today) : ymd(c.renewalDate!);
    return { ...c, date, days: daysUntil(date, today) };
  })
    .filter((c) => c.days <= COST_ALERT_DAYS);

  if (upcoming.length === 0) {
    return { dryRun, candidates: 0, sent: 0, skipped: 0, failed: 0, renewed: toAdvance.length, details };
  }

  const lines = upcoming.map((c) =>
    [
      c.name,
      c.supplier,
      `${formatEur(c.amountCents, c.currency)} ${periodLabel(c.periodMonths).toLowerCase()} (${vatLabel(c.vatPercent)})`,
      `${whenLabel(c.days)}, il ${dd(c.date)}`,
      c.recurring ? "ricorrente: la data si rinnova da sola" : "non ricorrente: aggiorna la data o segnalo come dismesso",
    ]
      .filter(Boolean)
      .join(" — "),
  );
  const total = upcoming.reduce((s, c) => s + c.amountCents, 0);
  const detailFor = (c: (typeof upcoming)[number], outcome: string, extra: Record<string, unknown> = {}) => ({
    outcome,
    client: c.name,
    services: c.supplier ?? "",
    dueDate: c.date,
    totalCents: c.amountCents,
    note: whenLabel(c.days),
    ...extra,
  });

  if (dryRun) {
    return {
      dryRun,
      candidates: upcoming.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      wouldSend: 1,
      renewed: toAdvance.length,
      details: [...details, ...upcoming.map((c) => detailFor(c, "WOULD_SEND", { recipient: COST_ALERT_RECIPIENT }))],
    };
  }

  const appUrl = process.env.APP_URL ?? "";
  const content = buildCronSummaryEmail({
    subject: `[Radar] Costi in scadenza: ${upcoming.length} ${upcoming.length === 1 ? "rinnovo" : "rinnovi"} entro ${COST_ALERT_DAYS} giorni (${formatEur(total)})`,
    title: "Costi in scadenza",
    intro: `Questi costi si rinnovano entro ${COST_ALERT_DAYS} giorni. L'avviso si ripete ogni giorno finché la scadenza non cambia: i costi ricorrenti escono dall'elenco quando la data passa e si rinnova da sola; gli altri quando aggiorni la data o li segni come non più in uso.`,
    sections: [
      { heading: `Rinnovi — totale ${formatEur(total)}`, lines },
      { heading: "Apri in Radar", lines: [`${appUrl}/amministrazione/costi`] },
    ],
  });
  const res = await sendEmail(content, COST_ALERT_RECIPIENT, {
    type: "COST_RENEWAL_ALERT",
    trigger: "CRON",
    // Al massimo una mail al giorno, anche con più esecuzioni.
    dedupeKey: `cost-renewals:${today}`,
  });

  if (!res.ok) {
    return {
      dryRun,
      candidates: upcoming.length,
      sent: 0,
      skipped: 0,
      failed: upcoming.length,
      renewed: toAdvance.length,
      details: [...details, ...upcoming.map((c) => detailFor(c, "FAILED", { error: res.error ?? "invio non riuscito" }))],
    };
  }
  return {
    dryRun,
    candidates: upcoming.length,
    sent: res.skipped ? 0 : 1,
    skipped: res.skipped ? upcoming.length : 0,
    failed: 0,
    renewed: toAdvance.length,
    details: [
      ...details,
      ...upcoming.map((c) =>
        detailFor(c, res.skipped ? "SKIPPED" : "SENT", res.skipped ? { note: "avviso di oggi già inviato" } : { recipient: COST_ALERT_RECIPIENT }),
      ),
    ],
  };
}
