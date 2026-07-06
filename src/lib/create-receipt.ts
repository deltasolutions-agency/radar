import "server-only";
import type { Prisma, Receipt } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { splitVatFromGross } from "@/lib/vat";

/**
 * Client Prisma utilizzabile sia come istanza globale sia come client di
 * transazione ($transaction). Permette di comporre createReceiptForPayment
 * all'interno di transazioni più grandi (es. confirmPaymentAndRenew).
 */
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Compone l'indirizzo completo del cliente in una singola stringa leggibile,
 * saltando i campi vuoti. Es. "Via Roma 1, 20100 Milano (MI), IT".
 */
function formatClientAddress(client: {
  indirizzo: string | null;
  cap: string | null;
  citta: string | null;
  provincia: string | null;
  paese: string | null;
}): string | null {
  const cityLine = [
    client.cap,
    client.citta,
    client.provincia ? `(${client.provincia})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [client.indirizzo, cityLine || null, client.paese].filter(
    Boolean,
  );

  return parts.length ? parts.join(", ") : null;
}

/**
 * Genera il numero progressivo della ricevuta per l'anno corrente.
 * Formato: "RIC-YYYY-NNNN" (es. "RIC-2026-0001").
 */
async function nextReceiptNumber(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);

  const count = await db.receipt.count({
    where: { issuedAt: { gte: yearStart } },
  });

  return `RIC-${year}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Crea la Receipt a partire da un Payment già CONFERMATO.
 *
 * Legge Payment → Subscription → Client (snapshot cliente, uguale per tutti gli
 * item dato che appartengono allo stesso abbonamento/cliente) e Payment →
 * PaymentItem → SubscriptionItem → Service (una ReceiptLine per ciascuna riga
 * pagata). I dati sono denormalizzati così che il documento resti immutabile
 * anche se cliente o servizio verranno modificati in seguito.
 *
 * È idempotente: se il Payment ha già una ricevuta, la restituisce senza
 * crearne una nuova (importante per i retry del webhook Stripe).
 *
 * Accetta un client di transazione opzionale per essere composta dentro una
 * $transaction più ampia (default: istanza Prisma globale).
 *
 * @throws se il Payment non esiste o non è in stato CONFERMATO.
 */
export async function createReceiptForPayment(
  paymentId: string,
  db: Db = prisma,
): Promise<Receipt> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      receipt: true,
      subscription: { include: { client: true } },
      items: {
        include: { subscriptionItem: { include: { service: true } } },
      },
    },
  });

  if (!payment) {
    throw new Error(`Payment ${paymentId} non trovato`);
  }

  // Idempotenza: ricevuta già emessa.
  if (payment.receipt) {
    return payment.receipt;
  }

  if (payment.status !== "CONFERMATO") {
    throw new Error(
      `Impossibile emettere ricevuta: Payment ${paymentId} non è CONFERMATO (stato: ${payment.status})`,
    );
  }

  const paidAt = payment.paidAt ?? new Date();
  const { client } = payment.subscription;

  // Ogni PaymentItem.amountCents è il LORDO del servizio (IVA inclusa). Sulla
  // ricevuta la riga mostra il NETTO (imponibile): scorporo per riga e salvo il
  // netto in ReceiptLine.amountCents, così Σ righe === taxableAmountCents ESATTO.
  // L'inversione lordo→netto è esatta per ogni importo realistico (verificato).
  let taxableCents = 0;
  let vatCents = 0;
  const lines = payment.items.map((pi) => {
    const split = splitVatFromGross(pi.amountCents);
    taxableCents += split.taxableCents;
    vatCents += split.vatCents;
    return {
      serviceName: pi.subscriptionItem.service.name,
      description: pi.subscriptionItem.service.description,
      periodStart: pi.periodStart,
      periodEnd: pi.periodEnd,
      quantity: pi.subscriptionItem.quantity,
      amountCents: split.taxableCents, // NETTO (imponibile) della riga
    };
  });
  // Il costo di servizio (solo Stripe) si somma DOPO l'IVA sui servizi e NON
  // genera IVA propria (decisione definitiva: commissione senza IVA aggiuntiva).
  const serviceFeeCents = payment.serviceFeeCents ?? 0;
  const amountCents = taxableCents + vatCents + serviceFeeCents;

  const number = await nextReceiptNumber(db);

  return db.receipt.create({
    data: {
      paymentId: payment.id,
      number,

      // Snapshot cliente.
      clientName: client.name,
      ragioneSociale: client.ragioneSociale,
      partitaIva: client.partitaIva,
      codiceFiscale: client.codiceFiscale,
      clientEmail: client.email,
      clientAddress: formatClientAddress(client),

      // Snapshot economico.
      amountCents,
      taxableAmountCents: taxableCents,
      vatAmountCents: vatCents,
      serviceFeeCents,
      currency: payment.currency,
      method: payment.method,
      paidAt,

      // Righe di dettaglio (una per servizio pagato).
      lines: { create: lines },
    },
  });
}
