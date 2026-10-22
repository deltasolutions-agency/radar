import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadAutoChargeReminderHours } from "@/lib/reminder-settings";
import { clientDisplayName, idsHash } from "@/lib/cron/common";

// PIANO del cron orario autocharge-reminders: SOLA LETTURA. Condiviso da
// /api/cron/autocharge-reminders (reale e ?dryRun=1) e da scripts/cron-preview.ts.
//
// Per ogni richiesta di attivazione non usata creata nelle ultime 48 ore, ogni
// soglia oraria raggiunta e non ancora gestita produce:
//  - soglia intermedia → sollecito al CLIENTE;
//  - soglia più alta   → escalation all'ADMIN (solo notifica).
// Gli invii sono RAGGRUPPATI per cliente (un sollecito e un'escalation per
// cliente). Una soglia è "gestita" solo se l'invio riesce (o non è inviabile);
// se fallisce viene ritentata alle esecuzioni successive, max 3 tentativi.

export const ACTIVATION_WINDOW_HOURS = 48;
export const ACTIVATION_MAX_ATTEMPTS = 3;
const MS_PER_HOUR = 1000 * 60 * 60;

export type ActivationRequest = Prisma.AutoChargeRequestGetPayload<{
  include: { client: true; activationReminders: true };
}>;

export type DueMark = {
  request: ActivationRequest;
  mark: number;
  /** Tentativi già fatti per questa soglia (0 = mai tentata). */
  attempts: number;
};

export type ActivationGroup = {
  kind: "CLIENT_REMINDER" | "ADMIN_ESCALATION";
  clientId: string;
  clientName: string;
  /** Destinatario cliente (solo per CLIENT_REMINDER); null = non inviabile. */
  clientEmail: string | null;
  marks: DueMark[];
  dedupeKey: string;
};

export type ActivationPlan = {
  now: Date;
  hours: number[];
  candidates: number;
  groups: ActivationGroup[];
  /** Servizi coperti da ciascuna richiesta (per i contenuti delle email). */
  itemsById: Map<string, { serviceName: string; endClientName: string | null }>;
};

/** Calcola cosa farebbe il cron orario adesso. Nessuna scrittura. */
export async function planActivationReminders(now: Date): Promise<ActivationPlan> {
  const hours = [...(await loadAutoChargeReminderHours())].sort((a, b) => a - b);
  const maxHour = hours.length > 0 ? hours[hours.length - 1] : null;
  const windowStart = new Date(now.getTime() - ACTIVATION_WINDOW_HOURS * MS_PER_HOUR);

  const allRequests =
    maxHour == null
      ? []
      : await prisma.autoChargeRequest.findMany({
          where: { usedAt: null, createdAt: { gte: windowStart } },
          include: { client: true, activationReminders: true },
          orderBy: { createdAt: "asc" },
        });
  // Richieste che riguardano solo abbonamenti non attivi (in attesa del primo
  // pagamento o annullati): nessun sollecito.
  const notActiveIds = new Set(
    (
      await prisma.subscriptionItem.findMany({
        where: {
          id: { in: [...new Set(allRequests.flatMap((r) => r.itemIds))] },
          subscription: { activationState: { not: "ACTIVE" } },
        },
        select: { id: true },
      })
    ).map((it) => it.id),
  );
  const requests = allRequests.filter((r) => r.itemIds.some((id) => !notActiveIds.has(id)));

  const byKey = new Map<string, ActivationGroup>();
  for (const req of requests) {
    const elapsed = (now.getTime() - req.createdAt.getTime()) / MS_PER_HOUR;
    for (const mark of hours) {
      if (elapsed < mark) continue; // soglia non ancora raggiunta
      const row = req.activationReminders.find((r) => r.hoursMark === mark);
      if (row && !row.pendingRetry) continue; // già gestita
      const kind = mark === maxHour ? "ADMIN_ESCALATION" : "CLIENT_REMINDER";
      const key = `${kind}|${req.clientId}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          kind,
          clientId: req.clientId,
          clientName: clientDisplayName(req.client),
          clientEmail: req.client.email?.trim() ? req.client.email : null,
          marks: [],
          dedupeKey: "",
        };
        byKey.set(key, g);
      }
      g.marks.push({ request: req, mark, attempts: row?.attempts ?? 0 });
    }
  }

  const groups = [...byKey.values()];
  for (const g of groups) {
    const ref = g.marks.map((m) => `${m.request.id}@${m.mark}#${m.attempts}`);
    g.dedupeKey =
      g.kind === "ADMIN_ESCALATION"
        ? `activation-escalation:${g.clientId}:${idsHash(ref)}`
        : `activation-reminder:${g.clientId}:${idsHash(ref)}`;
  }

  const allItemIds = [...new Set(requests.flatMap((r) => r.itemIds))];
  const items = allItemIds.length
    ? await prisma.subscriptionItem.findMany({
        where: { id: { in: allItemIds } },
        select: { id: true, quantity: true, endClientName: true, service: { select: { name: true } } },
      })
    : [];
  const itemsById = new Map(
    items.map((it) => [
      it.id,
      {
        serviceName: it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name,
        endClientName: it.endClientName,
      },
    ]),
  );

  return { now, hours, candidates: requests.length, groups, itemsById };
}
