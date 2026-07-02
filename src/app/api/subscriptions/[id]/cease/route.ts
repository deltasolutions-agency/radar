import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/cease  → imposta status = CESSATO
// Consentito solo dagli stati ATTIVO / IN_SCADENZA / SCADUTO.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!subscription) return error("Abbonamento non trovato", 404);

    const ceasable = ["ATTIVO", "IN_SCADENZA", "SCADUTO"];
    if (!ceasable.includes(subscription.status)) {
      return error(
        `Impossibile cessare un abbonamento in stato ${subscription.status}.`,
        409,
      );
    }

    const updated = await prisma.subscription.update({
      where: { id: params.id },
      data: { status: "CESSATO" },
    });
    return json({ subscription: updated });
  });
}
