import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { getReceiptExpiryDate } from "@/lib/receipt-access";

type Params = { params: { id: string } };

// POST /api/receipts/[id]/reactivate
// Riattiva l'accesso pubblico alla ricevuta: la finestra di 10gg riparte da ora.
// Azione manuale dell'admin (mai automatica).
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const exists = await prisma.receipt.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) return error("Ricevuta non trovata", 404);

    const receipt = await prisma.receipt.update({
      where: { id: params.id },
      data: { publicAccessResetAt: new Date() },
    });

    return json({ receipt, expiresAt: getReceiptExpiryDate(receipt) });
  });
}
