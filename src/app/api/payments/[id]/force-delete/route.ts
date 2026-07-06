import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";

type Params = { params: { id: string } };

// DELETE /api/payments/[id]/force-delete
// Elimina PERMANENTEMENTE il solo LOG di un pagamento (NotificationLog collegati,
// ReceiptLine, Receipt, PaymentItem, Payment) — indipendentemente dallo stato
// (anche CONFERMATO/RIMBORSATO). Protetto dalla conferma testuale fissa "ELIMINA".
//
// ATTENZIONE: NON è uno storno. NON tocca lo stato/scadenza dei SubscriptionItem
// collegati: l'item resta esattamente come si trova. È la cancellazione secca del
// solo record di pagamento.
export function DELETE(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!payment) return error("Pagamento non trovato", 404);

    const body = await req.json().catch(() => ({}));
    const confirmText =
      typeof body?.confirmText === "string" ? body.confirmText : "";

    if (confirmText.trim() !== DELETE_CONFIRM_WORD) {
      return error("Testo di conferma non corrispondente", 400);
    }

    // Eliminazione esplicita in ordine, in un'unica transazione. I
    // NotificationLog con paymentId sono in SetNull: vanno rimossi a mano se si
    // vuole cancellarli (altrimenti resterebbero orfani con paymentId null).
    await prisma.$transaction(async (tx) => {
      await tx.notificationLog.deleteMany({ where: { paymentId: payment.id } });
      // Cancellando la ricevuta cascano le ReceiptLine.
      await tx.receipt.deleteMany({ where: { paymentId: payment.id } });
      await tx.paymentItem.deleteMany({ where: { paymentId: payment.id } });
      await tx.payment.delete({ where: { id: payment.id } });
    });

    return json({ ok: true });
  });
}
