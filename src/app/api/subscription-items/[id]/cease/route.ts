import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";

type Params = { params: { id: string } };

// POST /api/subscription-items/[id]/cease  → imposta status = CESSATO sulla riga
// Consentito dagli stati ATTIVO / IN_SCADENZA / SCADUTO / RINNOVATO
// (bloccato solo da CESSATO e SOSPESO).
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const item = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!item) return error("Riga non trovata", 404);

    const ceasable = ["ATTIVO", "IN_SCADENZA", "SCADUTO", "RINNOVATO"];
    if (!ceasable.includes(item.status)) {
      return error(
        `Impossibile cessare una riga in stato ${item.status}.`,
        409,
      );
    }

    const updated = await prisma.subscriptionItem.update({
      where: { id: params.id },
      data: { status: "CESSATO" },
    });
    return json({ item: updated });
  });
}
