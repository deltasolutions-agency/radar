import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { STICKY_ALERT_KINDS, type AlertKindValue } from "@/lib/vigilantes/meta";

// POST /api/vigilantes/alerts/:id/ack — "Segna come visto". Gli alert che si
// chiudono solo a mano (nuovo amministratore) vengono risolti; gli altri
// restano aperti ma escono dal riepilogo finché la situazione non cambia.
// { undo: true } annulla il "visto".
export function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const session = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { undo?: boolean };
    const alert = await prisma.wpAlert.findUnique({ where: { id: params.id } });
    if (!alert) return error("Alert non trovato", 404);
    const now = new Date();
    if (body.undo) {
      await prisma.wpAlert.update({ where: { id: alert.id }, data: { acknowledgedAt: null, acknowledgedBy: null } });
      return json({ ok: true });
    }
    const sticky = STICKY_ALERT_KINDS.includes(alert.kind as AlertKindValue);
    await prisma.wpAlert.update({
      where: { id: alert.id },
      data: {
        acknowledgedAt: now,
        acknowledgedBy: session.email,
        ...(sticky && !alert.resolvedAt ? { resolvedAt: now } : {}),
      },
    });
    return json({ ok: true, resolved: sticky });
  });
}
