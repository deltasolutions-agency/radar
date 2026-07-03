import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { serviceUpdateSchema } from "@/lib/validations";

type Params = { params: { id: string } };

// GET /api/services/[id]
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const service = await prisma.service.findUnique({
      where: { id: params.id },
    });
    if (!service) return error("Servizio non trovato", 404);
    return json({ service });
  });
}

// PATCH /api/services/[id]  → modifica (usato anche per disattivare: { active: false })
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const exists = await prisma.service.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) return error("Servizio non trovato", 404);

    const data = serviceUpdateSchema.parse(await req.json());
    const service = await prisma.service.update({
      where: { id: params.id },
      data,
    });
    return json({ service });
  });
}

// DELETE /api/services/[id]
export function DELETE(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const service = await prisma.service.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { subscriptionItems: true } } },
    });
    if (!service) return error("Servizio non trovato", 404);

    // Con righe di abbonamento collegate la cancellazione fisica è vietata: si
    // preferisce la disattivazione (PATCH { active: false }) per lo storico.
    if (service._count.subscriptionItems > 0) {
      return error(
        "Impossibile eliminare: il servizio ha abbonamenti collegati. " +
          "Disattivalo invece di eliminarlo.",
        409,
      );
    }

    await prisma.service.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
