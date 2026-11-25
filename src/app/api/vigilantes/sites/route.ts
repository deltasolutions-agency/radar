import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { generateSecret } from "@/lib/vigilantes/protocol";
import { siteCreateSchema } from "@/lib/vigilantes/validations";

// POST /api/vigilantes/sites — nuovo sito da monitorare (solo admin). Il
// secret viene generato qui; la chiave di collegamento si legge dal dettaglio.
export function POST(req: Request) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = siteCreateSchema.parse(await req.json());
    if (await prisma.wpSite.findUnique({ where: { url: data.url } })) {
      return error("Questo sito è già in Vigilantes", 409);
    }
    if (data.clientId && !(await prisma.client.findUnique({ where: { id: data.clientId } }))) {
      return error("Cliente non trovato", 400);
    }
    const site = await prisma.wpSite.create({
      data: { ...data, secret: generateSecret(), createdBy: session.email ?? null },
      select: { id: true },
    });
    return json({ site }, 201);
  });
}
