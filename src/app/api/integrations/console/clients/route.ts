import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientCreateSchema } from "@/lib/validations";
import { ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// POST /api/integrations/console/clients → crea il cliente, o lo riusa se esiste già (stessa P.IVA, altrimenti stessa email)
export function POST(req: NextRequest) {
  return withConsole(req, async (body) => {
    const data = clientCreateSchema.parse(body);
    const existing = data.partitaIva
      ? await prisma.client.findFirst({ where: { partitaIva: data.partitaIva } })
      : await prisma.client.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } } });
    if (existing) return ok({ clientId: existing.id, created: false });
    const client = await prisma.client.create({ data });
    return ok({ clientId: client.id, created: true }, 201);
  });
}
