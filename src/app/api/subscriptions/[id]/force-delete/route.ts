import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";

type Params = { params: { id: string } };

// DELETE /api/subscriptions/[id]/force-delete
// Elimina PERMANENTEMENTE la subscription e TUTTI i dati collegati (Payment,
// Receipt, NotificationLog). Protetto da conferma testuale esatta.
export function DELETE(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { client: true, service: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    // Stringa attesa: stessa formula del nome mostrato in UI.
    const clientName = subscription.client.ragioneSociale?.trim()
      ? subscription.client.ragioneSociale
      : subscription.client.name;
    const expected = `${clientName} / ${subscription.service.name}`;

    const body = await req.json().catch(() => ({}));
    const confirmText =
      typeof body?.confirmText === "string" ? body.confirmText : "";

    if (confirmText !== expected) {
      return error("Testo di conferma non corrispondente", 400);
    }

    // Eliminazione esplicita in ordine, in un'unica transazione.
    await prisma.$transaction(async (tx) => {
      const payments = await tx.payment.findMany({
        where: { subscriptionId: params.id },
        select: { id: true },
      });
      const paymentIds = payments.map((p) => p.id);

      await tx.notificationLog.deleteMany({
        where: {
          OR: [
            { subscriptionId: params.id },
            { paymentId: { in: paymentIds } },
          ],
        },
      });
      await tx.receipt.deleteMany({
        where: { paymentId: { in: paymentIds } },
      });
      await tx.payment.deleteMany({
        where: { subscriptionId: params.id },
      });
      await tx.subscription.delete({ where: { id: params.id } });
    });

    return json({ ok: true });
  });
}
