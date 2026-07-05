import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { SETTINGS_SINGLETON_ID } from "@/lib/reminder-settings";
import { REMINDER_CONFIGURABLE_TYPES } from "@/lib/email-templates";

// Array di interi ≥ 0, ordinati in modo decrescente per le pre-scadenze non è
// richiesto: la mappa è posizionale. Deduplichiamo e teniamo l'ordine dato.
const intArray = z
  .array(z.number().int().min(0).max(3650))
  .max(20)
  .transform((arr) => [...new Set(arr)]);

const overrideSchema = z.object({
  subject: z.string().trim().max(500).nullable().optional(),
  body: z.string().trim().max(5000).nullable().optional(),
});

const bodySchema = z.object({
  thresholdsLongDays: intArray.optional(),
  thresholdsShortDays: intArray.optional(),
  overdueDays: intArray.optional(),
  cessationDay: z.number().int().min(0).max(3650).optional(),
  templates: z.record(z.string(), overrideSchema).optional(),
});

// PATCH /api/settings/reminders — upsert soglie (singleton) + override testuali.
export function PATCH(req: NextRequest) {
  return withApi(async () => {
    await requireSession();

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return error("Dati non validi", 400, {
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const data = parsed.data;

    // ── Soglie (singleton) ────────────────────────────────────────────────
    const settingsData = {
      ...(data.thresholdsLongDays !== undefined
        ? { thresholdsLongDays: data.thresholdsLongDays }
        : {}),
      ...(data.thresholdsShortDays !== undefined
        ? { thresholdsShortDays: data.thresholdsShortDays }
        : {}),
      ...(data.overdueDays !== undefined
        ? { overdueDays: data.overdueDays }
        : {}),
      ...(data.cessationDay !== undefined
        ? { cessationDay: data.cessationDay }
        : {}),
    };

    await prisma.reminderSettings.upsert({
      where: { id: SETTINGS_SINGLETON_ID },
      create: { id: SETTINGS_SINGLETON_ID, ...settingsData },
      update: settingsData,
    });

    // ── Override testuali (una riga per tipo) ─────────────────────────────
    if (data.templates) {
      const allowed = new Set<string>(REMINDER_CONFIGURABLE_TYPES);
      for (const [type, ov] of Object.entries(data.templates)) {
        if (!allowed.has(type)) continue; // ignora tipi non configurabili
        // Stringhe vuote → null (torna al default).
        const subject = ov.subject?.trim() ? ov.subject.trim() : null;
        const body = ov.body?.trim() ? ov.body.trim() : null;

        if (subject === null && body === null) {
          // Nessun override: rimuovi l'eventuale record esistente.
          await prisma.reminderTemplate.deleteMany({
            where: { type: type as never },
          });
          continue;
        }
        await prisma.reminderTemplate.upsert({
          where: { type: type as never },
          create: { type: type as never, subject, body },
          update: { subject, body },
        });
      }
    }

    return json({ ok: true });
  });
}
