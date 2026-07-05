import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// Stati su cui NON ha senso attivare il rinnovo automatico (riga chiusa/sospesa).
const NON_ACTIVATABLE = ["CESSATO", "SOSPESO"] as const;

/**
 * Attiva o disattiva il rinnovo automatico in modo CUMULATIVO per cliente:
 * agisce su TUTTE le righe di servizio (SubscriptionItem) del cliente, non solo
 * su quella da cui è partita la richiesta. Il metodo di pagamento è unico per
 * cliente (Client.stripeDefaultPaymentMethodId), quindi un solo consenso/una
 * sola carta coprono tutti i servizi.
 *
 * - enabled=true: attiva su tutte le righe ATTIVABILI (esclude CESSATO/SOSPESO)
 *   e applica l'eventuale data di fine addebito comune. Le righe già cessate o
 *   sospese restano escluse.
 * - enabled=false: disattiva su TUTTE le righe del cliente (anche cessate: è
 *   comunque inerte), senza toccare le date di fine.
 *
 * Ritorna il numero di righe aggiornate.
 */
export async function setClientAutoChargeEnabled(
  clientId: string,
  enabled: boolean,
  opts: { autoChargeEndDate?: Date | null } = {},
  db: Db = prisma,
): Promise<number> {
  if (enabled) {
    const res = await db.subscriptionItem.updateMany({
      where: {
        subscription: { clientId },
        status: { notIn: [...NON_ACTIVATABLE] },
      },
      data: {
        autoChargeEnabled: true,
        // Ripristina il contatore fallimenti all'attivazione cumulativa.
        autoChargeFailCount: 0,
        ...(opts.autoChargeEndDate !== undefined
          ? { autoChargeEndDate: opts.autoChargeEndDate }
          : {}),
      },
    });
    return res.count;
  }

  const res = await db.subscriptionItem.updateMany({
    where: { subscription: { clientId } },
    data: { autoChargeEnabled: false },
  });
  return res.count;
}
