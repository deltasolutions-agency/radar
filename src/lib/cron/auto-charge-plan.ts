import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { periodDurationDays } from "@/lib/billing-period";
import { loadAutoChargeMaxDelayDays } from "@/lib/reminder-settings";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { addVatToNet } from "@/lib/vat";
import { withEndClient } from "@/lib/end-client";
import { renewalChargePriceCents } from "@/lib/renewal-price";
import { MS_PER_DAY, idsHash, serviceLabel, ymd } from "@/lib/cron/common";

// PIANO del cron auto-charge: SOLA LETTURA. Condiviso da /api/cron/auto-charge
// (esecuzione reale e ?dryRun=1) e da scripts/cron-preview.ts.
//
// Regole:
//  1. Si addebitano solo righe scadute da al massimo N giorni (Impostazioni,
//     ReminderSettings.autoChargeMaxDelayDays, default 3); oltre → nessun addebito, segnalazione all'admin.
//  2. Al massimo un addebito per riga per esecuzione, nessun recupero
//     multi-giorno (riga già addebitata di recente → esclusa).
//  3. Idempotency key Stripe deterministica per periodo e tentativo.
//  4. Righe "da riconciliare" (addebito riuscito, rinnovo fallito) escluse.
//  5. Nessun addebito se esiste già un Payment in attesa per la riga.
//  6. PERSONALIZZATA senza durata esclusa.


export const BLOCKING = ["CESSATO", "SOSPESO"] as const;

export type AutoChargeItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

export type AutoChargeExclusion =
  | "TOO_LATE"
  | "PENDING_PAYMENT"
  | "RECENTLY_CHARGED"
  | "NO_PERIOD"
  | "NEEDS_RECONCILE"
  | "NO_CARD";

export const EXCLUSION_LABELS: Record<AutoChargeExclusion, string> = {
  TOO_LATE: "scaduta oltre il ritardo massimo",
  PENDING_PAYMENT: "esiste già un pagamento in attesa",
  RECENTLY_CHARGED: "già addebitata di recente (nessun recupero multi-giorno)",
  NO_PERIOD: "periodicità personalizzata senza durata",
  NEEDS_RECONCILE: "da riconciliare (addebito riuscito, rinnovo non registrato)",
  NO_CARD: "rinnovo automatico attivo ma nessuna carta salvata",
};

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Giorni interi di ritardo rispetto alla scadenza (0 = scade oggi). */
export function lateDaysOf(endDate: Date, now: Date): number {
  return Math.floor((now.getTime() - endDate.getTime()) / MS_PER_DAY);
}

export type PlannedCharge = {
  subscriptionId: string;
  client: AutoChargeItem["subscription"]["client"];
  currency: string;
  endDate: Date;
  items: AutoChargeItem[];
  /** LORDO (netto + IVA) per riga, nello stesso ordine di items. */
  itemGrossCents: number[];
  servicesCents: number;
  serviceFeeCents: number;
  totalCents: number;
  /** Tentativo (0 = primo, 1 = secondo dopo un fallimento). */
  attempt: number;
  idempotencyKey: string;
  description: string;
};

export type AutoChargePlan = {
  now: Date;
  /** Ritardo massimo (giorni) in vigore per questa esecuzione. */
  maxDelayDays: number;
  candidates: number;
  toDisable: AutoChargeItem[];
  attemptedToday: AutoChargeItem[];
  excluded: { item: AutoChargeItem; reason: AutoChargeExclusion; lateDays: number }[];
  charges: PlannedCharge[];
};

/** Descrizione PaymentIntent: "Rinnovo automatico: Servizio – Cliente finale, ...". */
export function autoChargeDescription(items: AutoChargeItem[]): string {
  const names = items.map((it) => withEndClient(serviceLabel(it), it.endClientName));
  return `Rinnovo automatico: ${names.join(", ")}`.slice(0, 500);
}

const include = {
  service: true,
  subscription: { include: { client: true } },
} as const;

/** Calcola cosa farebbe il cron auto-charge adesso. Nessuna scrittura. */
export async function planAutoCharge(now: Date): Promise<AutoChargePlan> {
  const candidates = await prisma.subscriptionItem.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      subscription: { client: { stripeDefaultPaymentMethodId: { not: null } } },
    },
    include,
  });

  const toDisable: AutoChargeItem[] = [];
  const attemptedToday: AutoChargeItem[] = [];
  const excluded: AutoChargePlan["excluded"] = [];
  const eligible: AutoChargeItem[] = [];
  const maxDelayDays = await loadAutoChargeMaxDelayDays();
  // Un addebito riuscito in questa finestra blocca un nuovo addebito della riga
  // (nessun recupero multi-giorno).
  const recentSince = new Date(now.getTime() - (maxDelayDays + 1) * MS_PER_DAY);

  for (const item of candidates) {
    const client = item.subscription.client;
    const lateDays = lateDaysOf(item.endDate, now);
    if (item.autoChargeEndDate && item.autoChargeEndDate.getTime() < now.getTime()) {
      toDisable.push(item); // la route lo riporta a gestione manuale
      continue;
    }
    if (item.endDate.getTime() > now.getTime()) continue; // non ancora scaduta
    if (item.autoChargeReconcileAt) {
      excluded.push({ item, reason: "NEEDS_RECONCILE", lateDays });
      continue;
    }
    if (periodDurationDays(item) == null) {
      excluded.push({ item, reason: "NO_PERIOD", lateDays });
      continue;
    }
    if (item.autoChargeLastAttemptAt && isSameDay(item.autoChargeLastAttemptAt, now)) {
      attemptedToday.push(item);
      continue;
    }
    if (!client.stripeCustomerId || !client.stripeDefaultPaymentMethodId) continue;
    if (lateDays > maxDelayDays) {
      excluded.push({ item, reason: "TOO_LATE", lateDays });
      continue;
    }
    const pending = await prisma.paymentItem.findFirst({
      where: {
        subscriptionItemId: item.id,
        status: "IN_ATTESA",
        payment: { status: "IN_ATTESA" },
      },
      select: { id: true },
    });
    if (pending) {
      excluded.push({ item, reason: "PENDING_PAYMENT", lateDays });
      continue;
    }
    const recent = await prisma.paymentItem.findFirst({
      where: {
        subscriptionItemId: item.id,
        status: "CONFERMATO",
        createdAt: { gte: recentSince },
      },
      select: { id: true },
    });
    if (recent) {
      excluded.push({ item, reason: "RECENTLY_CHARGED", lateDays });
      continue;
    }
    eligible.push(item);
  }

  // Informativo: righe scadute con rinnovo automatico ma senza carta salvata.
  const noCard = await prisma.subscriptionItem.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      endDate: { lte: now },
      subscription: { client: { stripeDefaultPaymentMethodId: null } },
    },
    include,
  });
  for (const item of noCard) {
    excluded.push({ item, reason: "NO_CARD", lateDays: lateDaysOf(item.endDate, now) });
  }

  // Raggruppa per (abbonamento, valuta, giorno di scadenza): un addebito per
  // gruppo. Payment.subscriptionId lega un pagamento a un solo abbonamento e una
  // PaymentIntent ha una sola valuta.
  const groups = new Map<string, AutoChargeItem[]>();
  for (const item of eligible) {
    const key = `${item.subscriptionId}|${item.currency}|${ymd(item.endDate)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const charges: PlannedCharge[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    // Il prezzo è NETTO: per ogni riga si addebita il LORDO (netto + 22%) del
    // prezzo del PROSSIMO rinnovo (renewalChargePriceCents: invariato per
    // EVERY_RENEWAL, aumentato per ONCE non ancora applicato); costo di
    // servizio 1,5% (solo Stripe) sul lordo dei servizi.
    const itemGrossCents = group.map(
      (it) => addVatToNet(renewalChargePriceCents(it) * it.quantity).grossCents,
    );
    const servicesCents = itemGrossCents.reduce((sum, c) => sum + c, 0);
    const serviceFeeCents = computeServiceFeeCents(servicesCents, first.subscription.serviceFeeEnabled);
    const attempt = Math.max(...group.map((it) => it.autoChargeFailCount));
    charges.push({
      subscriptionId: first.subscriptionId,
      client: first.subscription.client,
      currency: first.currency,
      endDate: first.endDate,
      items: group,
      itemGrossCents,
      servicesCents,
      serviceFeeCents,
      totalCents: servicesCents + serviceFeeCents,
      attempt,
      // Deterministica per lo stesso periodo (e tentativo): Stripe non crea una
      // seconda PaymentIntent per la stessa chiave. Il tentativo è incluso perché
      // Stripe riproporrebbe l'esito negativo precedente entro 24h.
      idempotencyKey: `autocharge:${first.subscriptionId}:${ymd(first.endDate)}:${idsHash(group.map((it) => it.id))}:${attempt}`,
      description: autoChargeDescription(group),
    });
  }

  return { now, maxDelayDays, candidates: candidates.length, toDisable, attemptedToday, excluded, charges };
}
