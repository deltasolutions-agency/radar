import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import {
  serviceCreateSchema,
  SERVICE_TYPES,
  type ServiceTypeValue,
} from "@/lib/validations";

// GET /api/services?type=HOSTING&active=true  → lista servizi
export function GET(req: NextRequest) {
  return withApi(async () => {
    await requireSession();
    const sp = req.nextUrl.searchParams;

    const type = sp.get("type")?.trim();
    if (type && !SERVICE_TYPES.includes(type as ServiceTypeValue)) {
      return error("Tipo servizio non valido", 400);
    }

    const activeParam = sp.get("active");
    const search = sp.get("search")?.trim();

    const services = await prisma.service.findMany({
      where: {
        ...(type ? { type: type as ServiceTypeValue } : {}),
        ...(activeParam === "true"
          ? { active: true }
          : activeParam === "false"
            ? { active: false }
            : {}),
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return json({ services });
  });
}

// POST /api/services  → crea servizio
export function POST(req: NextRequest) {
  return withApi(async () => {
    await requireSession();
    const data = serviceCreateSchema.parse(await req.json());
    const service = await prisma.service.create({ data });
    return json({ service }, 201);
  });
}
