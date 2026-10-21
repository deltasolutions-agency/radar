import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Logica di SELEZIONE del cron auto-charge, condivisa tra la route
// /api/cron/auto-charge e lo script di sola lettura scripts/cron-preview.ts.
// Nessuna funzione qui scrive su DB o chiama Stripe.

export const BLOCKING = ["CESSATO", "SOSPESO"] as const;

// Riga idonea all'addebito, con relazioni caricate.
export type EligibleItem = Prisma.SubscriptionItemGetPayload<{
  include: { service: true; subscription: { include: { client: true } } };
}>;

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Chiave-giorno locale di una data (per raggruppare le righe con pari scadenza). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Righe con rinnovo automatico attivo e cliente con metodo di pagamento salvato. */
export function loadAutoChargeCandidates(): Promise<EligibleItem[]> {
  return prisma.subscriptionItem.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      subscription: {
        client: { stripeDefaultPaymentMethodId: { not: null } },
      },
    },
    include: {
      service: true,
      subscription: { include: { client: true } },
    },
  });
}

export type AutoChargeDecision =
  // Auto-charge scaduto → la route lo disattiva (torna a gestione manuale).
  | "DISABLE_EXPIRED"
  // Non ancora scaduto → non è il momento di addebitare.
  | "NOT_DUE"
  // Già tentato oggi → evita doppio tentativo (anche doppio addebito).
  | "ALREADY_ATTEMPTED_TODAY"
  // Mancano customer o metodo di pagamento sul Client.
  | "MISSING_PAYMENT_METHOD"
  | "ELIGIBLE";

/** Pre-filtro per riga: decide cosa farà il cron oggi con questa riga. */
export function classifyAutoChargeCandidate(
  item: EligibleItem,
  now: Date,
): AutoChargeDecision {
  const client = item.subscription.client;
  if (
    item.autoChargeEndDate &&
    item.autoChargeEndDate.getTime() < now.getTime()
  ) {
    return "DISABLE_EXPIRED";
  }
  if (item.endDate.getTime() > now.getTime()) return "NOT_DUE";
  if (
    item.autoChargeLastAttemptAt &&
    isSameDay(item.autoChargeLastAttemptAt, now)
  ) {
    return "ALREADY_ATTEMPTED_TODAY";
  }
  if (!client.stripeCustomerId || !client.stripeDefaultPaymentMethodId) {
    return "MISSING_PAYMENT_METHOD";
  }
  return "ELIGIBLE";
}

/**
 * Raggruppa per (abbonamento, valuta, giorno di scadenza): un addebito per gruppo.
 * Payment.subscriptionId lega un pagamento a un solo abbonamento: il gruppo
 * massimo è quindi per-abbonamento. Una PaymentIntent ha una sola valuta.
 */
export function groupAutoChargeItems(
  eligible: EligibleItem[],
): Map<string, EligibleItem[]> {
  const groups = new Map<string, EligibleItem[]>();
  for (const item of eligible) {
    const key = `${item.subscriptionId}|${item.currency}|${dayKey(item.endDate)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
