import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/send-email";
import {
  buildAutoChargeNotConfirmedEmail,
  buildAutoChargeReminderEmail,
  buildCronSummaryEmail,
  type ActivationRequestInfo,
} from "@/lib/email-templates";
import { formatDate } from "@/lib/format";
import type { CronResult } from "@/lib/cron/common";
import {
  ACTIVATION_MAX_ATTEMPTS,
  planActivationReminders,
  type ActivationGroup,
  type ActivationPlan,
  type DueMark,
} from "@/lib/cron/activation-reminders";

function groupDetail(g: ActivationGroup, extra: Record<string, unknown> = {}) {
  return {
    kind: g.kind,
    clientId: g.clientId,
    client: g.clientName,
    recipient: g.kind === "ADMIN_ESCALATION" ? "admin" : g.clientEmail,
    marks: g.marks.map((m) => ({ requestId: m.request.id, hoursMark: m.mark, attempts: m.attempts })),
    ...extra,
  };
}

function requestInfos(g: ActivationGroup, plan: ActivationPlan, appUrl: string): ActivationRequestInfo[] {
  // Una voce per richiesta (una richiesta può avere più soglie dovute insieme).
  const seen = new Set<string>();
  const out: ActivationRequestInfo[] = [];
  for (const m of g.marks) {
    if (seen.has(m.request.id)) continue;
    seen.add(m.request.id);
    out.push({
      activationUrl: `${appUrl}/attiva-rinnovo/${m.request.token}`,
      requestedAt: m.request.createdAt,
      items: m.request.itemIds
        .map((id) => plan.itemsById.get(id))
        .filter((x): x is { serviceName: string; endClientName: string | null } => !!x),
    });
  }
  return out;
}

/** Segna le soglie come gestite (ok) o da ritentare (fallimento, max 3). */
async function markOutcome(marks: DueMark[], ok: boolean, error?: string): Promise<DueMark[]> {
  const exhausted: DueMark[] = [];
  for (const m of marks) {
    const attempts = m.attempts + 1;
    const pendingRetry = !ok && attempts < ACTIVATION_MAX_ATTEMPTS;
    if (!ok && !pendingRetry) exhausted.push(m);
    await prisma.autoChargeActivationReminder.upsert({
      where: {
        autoChargeRequestId_hoursMark: { autoChargeRequestId: m.request.id, hoursMark: m.mark },
      },
      create: {
        autoChargeRequestId: m.request.id,
        hoursMark: m.mark,
        attempts,
        pendingRetry,
        lastError: ok ? null : (error ?? "errore"),
      },
      update: {
        attempts,
        pendingRetry,
        lastError: ok ? null : (error ?? "errore"),
        sentAt: new Date(),
      },
    });
  }
  return exhausted;
}

/** Esegue (o simula, con dryRun) il cron orario dei solleciti di attivazione. */
export async function runActivationReminders({
  now,
  dryRun,
}: {
  now: Date;
  dryRun: boolean;
}): Promise<CronResult> {
  const plan = await planActivationReminders(now);
  const appUrl = process.env.APP_URL;

  if (dryRun) {
    return {
      dryRun: true,
      candidates: plan.candidates,
      sent: 0,
      skipped: 0,
      failed: 0,
      wouldSend: plan.groups.filter((g) => g.kind === "ADMIN_ESCALATION" || (g.clientEmail && appUrl)).length,
      details: plan.groups.map((g) =>
        groupDetail(g, {
          outcome:
            g.kind === "CLIENT_REMINDER" && (!g.clientEmail || !appUrl) ? "NOT_SENDABLE" : "WOULD_SEND",
        }),
      ),
    };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details: Record<string, unknown>[] = [];
  const exhaustedLines: string[] = [];

  for (const g of plan.groups) {
    try {
      // Sollecito cliente non inviabile (email o APP_URL assenti): soglia gestita
      // senza invio, come in precedenza.
      if (g.kind === "CLIENT_REMINDER" && (!g.clientEmail || !appUrl)) {
        await markOutcome(g.marks, true);
        skipped++;
        details.push(groupDetail(g, { outcome: "NOT_SENDABLE" }));
        continue;
      }
      const requests = requestInfos(g, plan, appUrl ?? "");
      const itemIds = [...new Set(g.marks.flatMap((m) => m.request.itemIds))];
      const res =
        g.kind === "ADMIN_ESCALATION"
          ? await sendEmail(
              buildAutoChargeNotConfirmedEmail({ clientName: g.clientName, requests }),
              undefined,
              { type: "ADMIN_ESCALATION", trigger: "CRON", clientId: g.clientId, itemIds, dedupeKey: g.dedupeKey },
            )
          : await sendEmail(
              buildAutoChargeReminderEmail({ clientName: g.clientName, requests }),
              g.clientEmail!,
              {
                type: "AUTOCHARGE_ACTIVATION_REMINDER",
                trigger: "CRON",
                clientId: g.clientId,
                itemIds,
                dedupeKey: g.dedupeKey,
              },
            );
      const exhausted = await markOutcome(g.marks, res.ok, res.error);
      if (res.skipped) skipped++;
      else if (res.ok) sent++;
      else failed++;
      for (const m of exhausted) {
        exhaustedLines.push(
          `${g.clientName} · ${g.kind === "ADMIN_ESCALATION" ? "escalation admin" : "sollecito cliente"} soglia ${m.mark}h (richiesta del ${formatDate(m.request.createdAt)}) — ${res.error ?? "errore"}`,
        );
      }
      details.push(
        groupDetail(g, {
          outcome: res.skipped ? "SKIPPED" : res.ok ? "SENT" : "FAILED",
          error: res.error,
          emailLogId: res.logId,
          exhausted: exhausted.length,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron autocharge-reminders] errore (cliente ${g.clientId}):`, e);
      failed++;
      details.push(groupDetail(g, { outcome: "ERROR", error: msg }));
    }
  }

  // Tentativi esauriti → segnalazione admin (una email per esecuzione).
  if (exhaustedLines.length > 0) {
    await sendEmail(
      buildCronSummaryEmail({
        subject: `[Radar] Solleciti rinnovo automatico non inviati: ${exhaustedLines.length}`,
        title: "Solleciti di attivazione non inviati",
        intro: `Dopo ${ACTIVATION_MAX_ATTEMPTS} tentativi non è stato possibile inviare i seguenti solleciti. Verifica nel Log email e valuta un contatto diretto.`,
        sections: [{ heading: "Tentativi esauriti", lines: exhaustedLines }],
      }),
      undefined,
      { type: "ADMIN_SUMMARY", trigger: "CRON" },
    );
  }

  return { dryRun: false, candidates: plan.candidates, sent, skipped, failed, details };
}
