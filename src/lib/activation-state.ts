import type { Prisma, SubscriptionActivationState } from "@prisma/client";

// Filtri e etichette dello stato di attivazione, senza dipendenze server
// (usati da cron, dashboard, liste e script di anteprima).

/** Solo abbonamenti operativi (tutti quelli esistenti prima della funzione). */
export const ACTIVE_SUBSCRIPTION_WHERE = {
  activationState: "ACTIVE",
} satisfies Prisma.SubscriptionWhereInput;

/** Righe di abbonamenti operativi. */
export const ACTIVE_ITEM_WHERE = {
  subscription: ACTIVE_SUBSCRIPTION_WHERE,
} satisfies Prisma.SubscriptionItemWhereInput;

export const ACTIVATION_STATE_LABELS: Record<SubscriptionActivationState, string> = {
  ACTIVE: "Attivo",
  PENDING_FIRST_PAYMENT: "In attesa di pagamento",
  CANCELLED_BEFORE_START: "Annullato",
};

/** Messaggio per le azioni di rinnovo su un abbonamento non ancora attivo. */
export function notActiveMessage(state: SubscriptionActivationState): string | null {
  if (state === "PENDING_FIRST_PAYMENT") {
    return "L'abbonamento è in attesa del primo pagamento: usa \"Segna come pagato\" o \"Reinvia link primo pagamento\".";
  }
  if (state === "CANCELLED_BEFORE_START") return "L'abbonamento è stato annullato.";
  return null;
}
