import type {
  NotificationType,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { isShortPeriod } from "@/lib/reminder-schedule";
import {
  loadReminderThresholds,
  type ReminderThresholds,
} from "@/lib/reminder-settings";
import { addVatToNet } from "@/lib/vat";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { withEndClient } from "@/lib/end-client";
import {
  MS_PER_DAY,
  clientDisplayName,
  idsHash,
  serviceLabel,
  ymd,
} from "@/lib/cron/common";

// PIANO del cron reminder: SOLA LETTURA. Condiviso da /api/cron/reminders
// (esecuzione reale e ?dryRun=1) e da scripts/cron-preview.ts.
//
// Regole:
//  - Per ogni riga si considera l'ULTIMA milestone dovuta (la più recente con
//    data ≤ oggi). Se non è ancora stata inviata (NotificationLog INVIATA al
//    cliente dopo la sua data) la si invia: un cron saltato non fa perdere
//    l'avviso. Mai più di un'email per riga per esecuzione.
//  - Recupero solo se la milestone è dovuta da al massimo REMINDER_RECOVERY_DAYS
//    giorni; oltre → "arretrato": nessuna email, segnalato all'admin.
//  - Cessazione con ritardo ≥ soglia, ma solo entro la stessa finestra.
//  - Righe dello stesso abbonamento, stessa scadenza e stessa milestone →
//    un'unica email al cliente.

/** Giorni massimi di recupero di una milestone non inviata. */
export const REMINDER_RECOVERY_DAYS = 3;
/** Preavviso addebito automatico: giorni prima della scadenza (fisso). */
export const PREAVVISO_OFFSET_DAYS = 7;

// Stati manuali bloccanti: mai toccati dal cron.
export const BLOCKING = ["CESSATO", "SOSPESO"] as const;

const PRE_EXPIRY_TYPES: NotificationType[] = [
  "PROMEMORIA_30",
  "PROMEMORIA_15",
  "PROMEMORIA_7",
];

export type ReminderItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

export type Milestone = {
  kind: "REMINDER" | "PREAVVISO";
  type: NotificationType;
  /** Giorni PRIMA della scadenza (negativo = dopo la scadenza). */
  offset: number;
  isCessation: boolean;
};

/** Tutte le milestone di una riga, dalle soglie configurate. */
export function milestoneSchedule(
  item: Pick<
    ReminderItem,
    "billingPeriod" | "customPeriodDays" | "autoChargeEnabled"
  >,
  settings: ReminderThresholds,
): Milestone[] {
  const out: Milestone[] = [];
  const preDays = isShortPeriod(item.billingPeriod, item.customPeriodDays)
    ? settings.thresholdsShortDays
    : settings.thresholdsLongDays;
  preDays.slice(0, PRE_EXPIRY_TYPES.length).forEach((d, i) => {
    // Con rinnovo automatico il preavviso addebito sostituisce l'avviso a 7 gg.
    if (item.autoChargeEnabled && d === PREAVVISO_OFFSET_DAYS) return;
    out.push({ kind: "REMINDER", type: PRE_EXPIRY_TYPES[i], offset: d, isCessation: false });
  });
  if (item.autoChargeEnabled) {
    out.push({
      kind: "PREAVVISO",
      type: "PREAVVISO_ADDEBITO",
      offset: PREAVVISO_OFFSET_DAYS,
      isCessation: false,
    });
  }
  for (const d of settings.overdueDays) {
    if (d >= settings.cessationDay) continue; // dopo la cessazione non si sollecita
    out.push({ kind: "REMINDER", type: "SOLLECITO", offset: -d, isCessation: false });
  }
  out.push({
    kind: "REMINDER",
    type: "CESSAZIONE_MOROSITA",
    offset: -settings.cessationDay,
    isCessation: true,
  });
  return out;
}

/** Giorni mancanti alla scadenza (Math.ceil, come computeItemStatus). */
export function diffDaysOf(endDate: Date, now: Date): number {
  return Math.ceil((endDate.getTime() - now.getTime()) / MS_PER_DAY);
}

export type DueMilestone = {
  milestone: Milestone;
  diffDays: number;
  /** Giorni trascorsi da quando la milestone è dovuta (0 = oggi). */
  daysLate: number;
  /** Momento da cui la milestone è dovuta (endDate − offset giorni). */
  dueAt: Date;
};

/** Ultima milestone dovuta (la più recente con data ≤ adesso), o null. */
export function latestDueMilestone(
  item: Pick<
    ReminderItem,
    "endDate" | "billingPeriod" | "customPeriodDays" | "autoChargeEnabled"
  >,
  settings: ReminderThresholds,
  now: Date,
): DueMilestone | null {
  const diffDays = diffDaysOf(item.endDate, now);
  let best: Milestone | null = null;
  for (const m of milestoneSchedule(item, settings)) {
    if (m.offset < diffDays) continue; // non ancora dovuta
    if (!best || m.offset < best.offset) best = m;
  }
  if (!best) return null;
  return {
    milestone: best,
    diffDays,
    daysLate: best.offset - diffDays,
    dueAt: new Date(item.endDate.getTime() - best.offset * MS_PER_DAY),
  };
}

/**
 * true se la milestone risulta già gestita per il cliente: NotificationLog INVIATA
 * (o FALLITA perché il cliente non ha email)
 * per la riga e il tipo, registrata dopo la data della milestone (esclusi gli
 * invii admin del vecchio cron, chiave "...-admin"). Copre sia i log del
 * vecchio cron (chiave giornaliera) sia quelli nuovi (chiave per milestone).
 */
export async function milestoneAlreadySent(
  subscriptionItemId: string,
  type: NotificationType,
  dueAt: Date,
): Promise<boolean> {
  const found = await prisma.notificationLog.findFirst({
    where: {
      subscriptionItemId,
      type,
      sentAt: { gte: dueAt },
      AND: [
        // Inviata, oppure non inviabile per email mancante (errore non
        // transitorio: segnalato una volta nel riepilogo, non ritentato).
        { OR: [{ status: "INVIATA" }, { recipient: NO_EMAIL_RECIPIENT }] },
        { OR: [{ dedupeKey: null }, { NOT: { dedupeKey: { endsWith: "-admin" } } }] },
      ],
    },
    select: { id: true },
  });
  return found != null;
}

/** Destinatario registrato nel NotificationLog quando il cliente non ha email. */
export const NO_EMAIL_RECIPIENT = "(cliente senza email)";

/** dedupeKey NotificationLog (per riga) di una milestone: "m:{scadenza}:{offset}". */
export function milestoneLogKey(endDate: Date, offset: number): string {
  return `m:${ymd(endDate)}:${offset}`;
}

export type GroupAmounts = {
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Costo di servizio sul lordo (solo pagamenti Stripe). */
  serviceFeeCents: number;
  /** Lordo + costo di servizio (importo di un addebito/link Stripe). */
  totalCents: number;
};

/**
 * Importi di un gruppo: IVA per riga con addVatToNet e somma, costo di servizio
 * sul lordo dei servizi — IDENTICO a checkout Stripe e cron auto-charge.
 */
export function groupAmounts(
  items: { priceCents: number; quantity: number }[],
  serviceFeeEnabled: boolean,
): GroupAmounts {
  let netCents = 0;
  let vatCents = 0;
  let grossCents = 0;
  for (const it of items) {
    const r = addVatToNet(it.priceCents * it.quantity);
    netCents += r.netCents;
    vatCents += r.vatCents;
    grossCents += r.grossCents;
  }
  const serviceFeeCents = computeServiceFeeCents(grossCents, serviceFeeEnabled);
  return { netCents, vatCents, grossCents, serviceFeeCents, totalCents: grossCents + serviceFeeCents };
}

export type PlannedGroup = {
  kind: Milestone["kind"];
  type: NotificationType;
  offset: number;
  isCessation: boolean;
  subscriptionId: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  endDate: Date;
  diffDays: number;
  daysLate: number;
  autoCharge: boolean;
  serviceFeeEnabled: boolean;
  currency: string;
  items: ReminderItem[];
  amounts: GroupAmounts;
  /** payToken di un Payment IN_ATTESA riusabile (righe senza rinnovo automatico). */
  reusablePayToken: string | null;
  /** Token di una AutoChargeRequest pendente che copre tutte le righe. */
  reusableAutoChargeToken: string | null;
  /** Chiave anti-doppio dell'EmailLog. */
  emailDedupeKey: string;
};

export type BacklogEntry = {
  item: ReminderItem;
  type: NotificationType;
  offset: number;
  daysLate: number;
};

export type ReminderPlan = {
  now: Date;
  settings: ReminderThresholds;
  statusChanges: { id: string; from: SubscriptionStatus; to: SubscriptionStatus }[];
  candidates: number;
  groups: PlannedGroup[];
  /** Righe la cui ultima milestone dovuta è già stata inviata. */
  alreadySent: number;
  backlog: BacklogEntry[];
};

/** Payment Stripe IN_ATTESA che copre ESATTAMENTE queste righe per questa scadenza. */
async function findReusablePayToken(itemIds: string[], endDate: Date): Promise<string | null> {
  const candidates = await prisma.payment.findMany({
    where: {
      status: "IN_ATTESA",
      method: "STRIPE",
      stripeCheckoutSessionId: { not: null },
      items: { some: { subscriptionItemId: { in: itemIds } } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      payToken: true,
      items: { select: { subscriptionItemId: true, periodStart: true, status: true } },
    },
  });
  const wanted = new Set(itemIds);
  for (const p of candidates) {
    const ids = p.items.map((pi) => pi.subscriptionItemId);
    const sameSet = ids.length === wanted.size && ids.every((id) => wanted.has(id));
    const samePeriod = p.items.every(
      (pi) => pi.status === "IN_ATTESA" && pi.periodStart?.getTime() === endDate.getTime(),
    );
    if (sameSet && samePeriod) return p.payToken;
  }
  return null;
}

/** AutoChargeRequest non usata del cliente che include tutte le righe. */
async function findReusableAutoChargeToken(clientId: string, itemIds: string[]): Promise<string | null> {
  const r = await prisma.autoChargeRequest.findFirst({
    where: { clientId, usedAt: null, itemIds: { hasEvery: itemIds } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  return r?.token ?? null;
}

/** Calcola cosa farebbe il cron reminder adesso. Nessuna scrittura. */
export async function planReminders(now: Date): Promise<ReminderPlan> {
  const settings = await loadReminderThresholds();

  const items = await prisma.subscriptionItem.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    include: { service: true, subscription: { include: { client: true } } },
  });

  // Step 1 della route: ricalcolo status (applicato solo nell'esecuzione reale).
  const statusChanges: ReminderPlan["statusChanges"] = [];
  for (const it of items) {
    const next = computeItemStatus(it);
    if (next !== it.status) statusChanges.push({ id: it.id, from: it.status, to: next });
  }

  const byGroup = new Map<string, { due: DueMilestone; items: ReminderItem[] }>();
  const backlog: BacklogEntry[] = [];
  let alreadySent = 0;

  for (const item of items) {
    const due = latestDueMilestone(item, settings, now);
    if (!due) continue;
    if (await milestoneAlreadySent(item.id, due.milestone.type, due.dueAt)) {
      alreadySent++;
      continue;
    }
    if (due.daysLate > REMINDER_RECOVERY_DAYS) {
      backlog.push({ item, type: due.milestone.type, offset: due.milestone.offset, daysLate: due.daysLate });
      continue;
    }
    const key = [
      item.subscriptionId,
      item.currency,
      ymd(item.endDate),
      due.milestone.type,
      due.milestone.offset,
      item.autoChargeEnabled ? "auto" : "manual",
    ].join("|");
    const g = byGroup.get(key);
    if (g) g.items.push(item);
    else byGroup.set(key, { due, items: [item] });
  }

  const appUrl = process.env.APP_URL;
  const groups: PlannedGroup[] = [];
  for (const { due, items: groupItems } of byGroup.values()) {
    const first = groupItems[0];
    const client = first.subscription.client;
    const ids = groupItems.map((it) => it.id);
    const m = due.milestone;
    const autoCharge = first.autoChargeEnabled;
    const clientEmail = client.email?.trim() ? client.email : null;
    // Link/CTA solo se l'email parte davvero (cliente con email, APP_URL).
    const needsLinks = m.kind === "REMINDER" && !autoCharge && !!appUrl && !!clientEmail;
    groups.push({
      kind: m.kind,
      type: m.type,
      offset: m.offset,
      isCessation: m.isCessation,
      subscriptionId: first.subscriptionId,
      clientId: client.id,
      clientName: clientDisplayName(client),
      clientEmail,
      endDate: first.endDate,
      diffDays: due.diffDays,
      daysLate: due.daysLate,
      autoCharge,
      serviceFeeEnabled: first.subscription.serviceFeeEnabled,
      currency: first.currency,
      items: groupItems,
      amounts: groupAmounts(groupItems, first.subscription.serviceFeeEnabled),
      reusablePayToken: needsLinks ? await findReusablePayToken(ids, first.endDate) : null,
      reusableAutoChargeToken:
        needsLinks && !m.isCessation ? await findReusableAutoChargeToken(client.id, ids) : null,
      emailDedupeKey:
        m.kind === "PREAVVISO"
          ? `autocharge-notice:${first.subscriptionId}:${ymd(first.endDate)}:${m.offset}:${idsHash(ids)}`
          : `reminder:${first.subscriptionId}:${ymd(first.endDate)}:${m.offset}:${idsHash(ids)}`,
    });
  }
  groups.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.endDate.getTime() - b.endDate.getTime());

  return {
    now,
    settings,
    statusChanges,
    candidates: items.length,
    groups,
    alreadySent,
    backlog,
  };
}

/** Etichetta leggibile di una milestone (riepiloghi, preview). */
export function milestoneLabel(g: { type: string; offset: number }): string {
  switch (g.type) {
    case "PREAVVISO_ADDEBITO":
      return `Preavviso addebito (−${g.offset} gg)`;
    case "SOLLECITO":
      return g.offset === 0 ? "Sollecito (giorno di scadenza)" : `Sollecito (+${-g.offset} gg)`;
    case "CESSAZIONE_MOROSITA":
      return `Cessazione per morosità (+${-g.offset} gg)`;
    default:
      return `Promemoria (−${g.offset} gg)`;
  }
}

/** Elenco servizi di un gruppo, con cliente finale. */
export function groupServicesLabel(g: PlannedGroup): string {
  return g.items.map((it) => withEndClient(serviceLabel(it), it.endClientName)).join(", ");
}
