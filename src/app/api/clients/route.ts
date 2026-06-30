import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, withApi, requireSession } from "@/lib/api";
import { clientCreateSchema } from "@/lib/validations";

// GET /api/clients?search=...  → lista clienti
export function GET(req: NextRequest) {
  return withApi(async () => {
    await requireSession();

    const search = req.nextUrl.searchParams.get("search")?.trim();
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            {
              ragioneSociale: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {};

    const clients = await prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
    });
    return json({ clients });
  });
}

// POST /api/clients  → crea cliente
export function POST(req: NextRequest) {
  return withApi(async () => {
    await requireSession();
    const body = await req.json();
    const data = clientCreateSchema.parse(body);
    const client = await prisma.client.create({ data });
    return json({ client }, 201);
  });
}
