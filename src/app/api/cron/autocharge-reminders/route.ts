import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/send-email";
import {
  buildAutoChargeReminderEmail,
  buildAutoChargeNotConfirmedEmail,
} from "@/lib/email-templates";
import { loadAutoChargeReminderHours } from "@/lib/reminder-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MS_PER_HOUR = 1000 * 60 * 60;
// Oltre questa finestra non solleciteremo più attivamente la richiesta pendente.
const WINDOW_HOURS = 48;

// GET /api/cron/autocharge-reminders
//
// Solleciti di ATTIVAZIONE del rinnovo automatico per le richieste pendenti
// (AutoChargeRequest con usedAt=null) create nelle ultime 48 ore.
//
// Per ogni soglia oraria configurata (ReminderSettings.autoChargeReminderHours,
// default [12,24]) raggiunta e non ancora sollecitata:
//  - soglia intermedia (non la più alta) → reminder GENTILE al CLIENTE con il link;
//  - soglia più alta (ultima) → escalation all'ADMIN (solo notifica: la decisione
//    su come procedere resta all'admin — NESSUNA auto-azione).
// Ogni soglia è tracciata da un AutoChargeActivationReminder (unique per
// [autoChargeRequestId, hoursMark]) per non reinviare lo stesso sollecito.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const now = new Date();
  const appUrl = process.env.APP_URL;
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * MS_PER_HOUR);

  // Soglie ordinate crescenti; la più alta è l'escalation admin.
  const hours = [...(await loadAutoChargeReminderHours())].sort((a, b) => a - b);
  const maxHour = hours.length > 0 ? hours[hours.length - 1] : null;

  let checked = 0;
  let clientRemindersSent = 0;
  let adminEscalationsSent = 0;

  if (maxHour == null) {
    return NextResponse.json({ checked, clientRemindersSent, adminEscalationsSent });
  }

  const requests = await prisma.autoChargeRequest.findMany({
    where: { usedAt: null, createdAt: { gte: windowStart } },
    include: { client: true, activationReminders: true },
  });

  for (const req of requests) {
    checked++;
    try {
      const hoursElapsed = (now.getTime() - req.createdAt.getTime()) / MS_PER_HOUR;
      const alreadySent = new Set(
        req.activationReminders.map((r) => r.hoursMark),
      );

      for (const mark of hours) {
        if (hoursElapsed < mark) continue; // soglia non ancora raggiunta
        if (alreadySent.has(mark)) continue; // già sollecitata questa soglia

        const isEscalation = mark === maxHour;

        if (isEscalation) {
          // Escalation ADMIN — solo notifica, nessuna auto-azione.
          const clientName = req.client.ragioneSociale?.trim()
            ? req.client.ragioneSociale
            : req.client.name;
          const sent = await sendEmail(
            buildAutoChargeNotConfirmedEmail({
              clientName,
              requestedAt: req.createdAt,
            }),
          );
          if (sent.status === "INVIATA") adminEscalationsSent++;
        } else if (req.client.email && appUrl) {
          // Reminder gentile al CLIENTE con lo stesso link di attivazione.
          const clientName = req.client.ragioneSociale?.trim()
            ? req.client.ragioneSociale
            : req.client.name;
          const sent = await sendEmail(
            buildAutoChargeReminderEmail({
              clientName,
              activationUrl: `${appUrl}/attiva-rinnovo/${req.token}`,
            }),
            req.client.email,
          );
          if (sent.status === "INVIATA") clientRemindersSent++;
        }

        // Traccia la soglia come processata (anche se l'invio è fallito o è stato
        // saltato per email assente): evita loop/ricalcolo sulla stessa soglia.
        try {
          await prisma.autoChargeActivationReminder.create({
            data: { autoChargeRequestId: req.id, hoursMark: mark },
          });
          alreadySent.add(mark);
        } catch {
          // Corsa concorrente sul vincolo unique: già creato altrove, ignora.
        }
      }
    } catch (e) {
      console.error(
        `[cron autocharge-reminders] errore su richiesta ${req.id}:`,
        e,
      );
    }
  }

  return NextResponse.json({ checked, clientRemindersSent, adminEscalationsSent });
}
