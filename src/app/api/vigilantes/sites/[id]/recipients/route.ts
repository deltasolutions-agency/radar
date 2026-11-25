import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { VIGILANTES_ALERT_RECIPIENT } from "@/lib/vigilantes/meta";
import { recipientCreateSchema } from "@/lib/vigilantes/validations";

// POST /api/vigilantes/sites/:id/recipients — aggiunge un destinatario degli
// alert del sito (riceve solo ciò che riguarda questo sito). Solo admin.
export function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = recipientCreateSchema.parse(await req.json());
    if (data.email === VIGILANTES_ALERT_RECIPIENT) {
      return error(`${VIGILANTES_ALERT_RECIPIENT} riceve già tutto da ogni sito`, 400);
    }
    const site = await prisma.wpSite.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!site) return error("Sito non trovato", 404);
    const exists = await prisma.wpAlertRecipient.findUnique({
      where: { siteId_email: { siteId: site.id, email: data.email } },
    });
    if (exists) return error("Indirizzo già presente", 409);
    const recipient = await prisma.wpAlertRecipient.create({
      data: { siteId: site.id, email: data.email, mode: data.mode, createdBy: session.email },
    });
    return json({ recipient }, 201);
  });
}
