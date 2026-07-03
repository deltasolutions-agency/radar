import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";

type Params = { params: { id: string } };

// DELETE /api/subscriptions/[id]/force-delete
// Elimina PERMANENTEMENTE l'abbonamento e TUTTI i dati collegati (righe,
// pagamenti, ricevute, notifiche). Protetto da conferma testuale esatta =
// nome cliente visualizzato.
export function DELETE(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { client: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    // Stringa attesa: il nome cliente mostrato in UI (ragione sociale se presente).
    const expected = subscription.client.ragioneSociale?.trim()
      ? subscription.client.ragioneSociale
      : subscription.client.name;

    const body = await req.json().catch(() => ({}));
    const confirmText =
      typeof body?.confirmText === "string" ? body.confirmText : "";

    if (confirmText !== expected) {
      return error("Testo di conferma non corrispondente", 400);
    }

    // Eliminazione esplicita in ordine, in un'unica transazione.
    // I NotificationLog vanno rimossi prima (payment→SetNull li lascerebbe
    // orfani; item→Cascade li rimuove ma solo alla delete del contenitore).
    await prisma.$transaction(async (tx) => {
      const items = await tx.subscriptionItem.findMany({
        where: { subscriptionId: params.id },
        select: { id: true },
      });
      const itemIds = items.map((i) => i.id);

      const payments = await tx.payment.findMany({
        where: { subscriptionId: params.id },
        select: { id: true },
      });
      const paymentIds = payments.map((p) => p.id);

      await tx.notificationLog.deleteMany({
        where: {
          OR: [
            { subscriptionItemId: { in: itemIds } },
            { paymentId: { in: paymentIds } },
          ],
        },
      });
      // Cancellando i pagamenti cascano PaymentItem, Receipt e ReceiptLine.
      await tx.payment.deleteMany({ where: { subscriptionId: params.id } });
      // Cancellando il contenitore cascano le righe (SubscriptionItem).
      await tx.subscription.delete({ where: { id: params.id } });
    });

    return json({ ok: true });
  });
}
