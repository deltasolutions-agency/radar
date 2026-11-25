import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientCreateSchema } from "@/lib/validations";
import { ok, withConsole } from "@/lib/console-integration";

export const dynamic = "force-dynamic";

// GET /api/integrations/console/clients?q=… → clienti che corrispondono (ragione sociale, nome, email, P.IVA): il wizard della console li propone per compilare i dati
export function GET(req: NextRequest) {
  return withConsole(req, async () => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return ok({ clients: [] });
    const ci = { contains: q, mode: "insensitive" as const };
    const clients = await prisma.client.findMany({
      where: { OR: [{ ragioneSociale: ci }, { name: ci }, { email: ci }, { partitaIva: { contains: q.replace(/\s+/g, "") } }] },
      select: { id: true, name: true, email: true, phone: true, ragioneSociale: true, partitaIva: true, indirizzo: true, citta: true, cap: true, provincia: true },
      orderBy: { ragioneSociale: "asc" },
      take: 8,
    });
    return ok({ clients });
  });
}

// POST /api/integrations/console/clients → crea il cliente, o lo riusa se esiste già (stessa P.IVA, altrimenti stessa email)
export function POST(req: NextRequest) {
  return withConsole(req, async (body) => {
    const data = clientCreateSchema.parse(body);
    // P.IVA confrontata solo sulle cifre ("IT 012…" e "012…" sono lo stesso cliente)
    const vat = (data.partitaIva ?? "").replace(/\D/g, "");
    const existing = vat
      ? await prisma.client.findFirst({ where: { partitaIva: { contains: vat } }, orderBy: { createdAt: "asc" } })
      : await prisma.client.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
    if (existing) return ok({ clientId: existing.id, created: false });
    const client = await prisma.client.create({ data });
    return ok({ clientId: client.id, created: true }, 201);
  });
}
