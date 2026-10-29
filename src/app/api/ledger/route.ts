import { prisma } from "@/lib/prisma";
import { json, withApi, requireAdmin } from "@/lib/api";
import { dayFromYmd, ledgerCreateSchema } from "@/lib/ledger";

// POST /api/ledger — nuovo credito (Incassi) o debito (Dovuto). Solo admin.
// Sezione Amministrazione: indipendente da clienti, abbonamenti e pagamenti.
export function POST(req: Request) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = ledgerCreateSchema.parse(await req.json());
    const entry = await prisma.ledgerEntry.create({
      data: {
        kind: data.kind,
        counterparty: data.counterparty,
        description: data.description,
        amountCents: data.amountCents,
        dueDate: data.dueDate ? dayFromYmd(data.dueDate) : null,
        notes: data.notes,
        createdBy: session.email ?? null,
      },
    });
    return json({ entry }, 201);
  });
}
