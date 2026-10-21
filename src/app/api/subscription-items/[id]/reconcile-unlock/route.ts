import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireAdmin } from "@/lib/api";

type Params = { params: { id: string } };

// POST /api/subscription-items/[id]/reconcile-unlock — solo admin.
// Rimuove lo stato "da riconciliare" (addebito automatico riuscito ma rinnovo
// non registrato) e registra l'azione in AdminActionLog. Il Payment rimasto in
// attesa continua comunque a bloccare un nuovo addebito finché non è gestito.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const session = await requireAdmin();
    const item = await prisma.subscriptionItem.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        subscriptionId: true,
        autoChargeReconcileAt: true,
        autoChargeReconcileNote: true,
      },
    });
    if (!item) return error("Riga non trovata", 404);
    if (!item.autoChargeReconcileAt) {
      return error("La riga non è da riconciliare", 400);
    }
    await prisma.$transaction([
      prisma.subscriptionItem.update({
        where: { id: item.id },
        data: { autoChargeReconcileAt: null, autoChargeReconcileNote: null },
      }),
      prisma.adminActionLog.create({
        data: {
          userId: session.sub,
          userEmail: session.email,
          action: "AUTOCHARGE_RECONCILE_UNLOCK",
          entityType: "SubscriptionItem",
          entityId: item.id,
          details: {
            subscriptionId: item.subscriptionId,
            reconcileAt: item.autoChargeReconcileAt.toISOString(),
            note: item.autoChargeReconcileNote,
          },
        },
      }),
    ]);
    return json({ ok: true });
  });
}
