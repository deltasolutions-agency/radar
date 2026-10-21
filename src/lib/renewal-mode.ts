import type { RenewalIncreaseMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Indicatore renewalIncreaseAppliedAt da impostare quando cambia la modalità di
 * aumento di una riga. undefined = invariato.
 *
 * - EVERY_RENEWAL → ONCE su una riga che ha GIÀ avuto almeno un rinnovo con
 *   aumento (un rinnovo confermato, non stornato, che ha alzato il prezzo):
 *   prezzo bloccato subito (indicatore = ora), nessun ulteriore aumento.
 * - EVERY_RENEWAL → ONCE su una riga mai aumentata: indicatore invariato
 *   (null) → l'aumento si paga al prossimo rinnovo, poi blocco.
 * - Qualsiasi passaggio con indicatore già valorizzato: invariato. Quindi
 *   ONCE (applicato) → EVERY_RENEWAL riprende gli aumenti a ogni rinnovo, e un
 *   successivo ritorno a ONCE blocca subito il prezzo corrente.
 */
export async function appliedAtOnModeChange(
  item: {
    id: string;
    priceCents: number;
    renewalIncreaseMode: RenewalIncreaseMode;
    renewalIncreaseAppliedAt: Date | null;
  },
  newMode: RenewalIncreaseMode | undefined,
  now: Date = new Date(),
): Promise<Date | undefined> {
  if (!newMode || newMode !== "ONCE" || item.renewalIncreaseMode === "ONCE") return undefined;
  if (item.renewalIncreaseAppliedAt) return undefined;
  const increased = await prisma.paymentItem.findFirst({
    where: {
      subscriptionItemId: item.id,
      status: "CONFERMATO",
      previousPriceCents: { not: null, lt: item.priceCents },
    },
    select: { id: true },
  });
  return increased ? now : undefined;
}

/** true se la riga ha già avuto un rinnovo con aumento (per l'anteprima del form). */
export async function hasPastIncrease(itemId: string, priceCents: number): Promise<boolean> {
  const found = await prisma.paymentItem.findFirst({
    where: {
      subscriptionItemId: itemId,
      status: "CONFERMATO",
      previousPriceCents: { not: null, lt: priceCents },
    },
    select: { id: true },
  });
  return found != null;
}
