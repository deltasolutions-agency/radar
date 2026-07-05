import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { setClientAutoChargeEnabled } from "@/lib/auto-charge";

type Params = { params: { id: string } };

// POST /api/clients/[id]/auto-charge
// Attiva/disattiva il rinnovo automatico in modo CUMULATIVO su tutte le righe
// del cliente. Body: { enabled: boolean, autoChargeEndDate?: string|null }.
//
// - Attivazione: richiede una carta salvata (Client.stripeDefaultPaymentMethodId).
//   Se manca, 400: il metodo va prima registrato dal cliente ("Invia richiesta").
// - Disattivazione: sempre consentita (la carta resta salvata).
export function POST(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const body = await req.json().catch(() => ({}));
    const enabled = body?.enabled === true;

    const client = await prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, stripeDefaultPaymentMethodId: true },
    });
    if (!client) return error("Cliente non trovato", 404);

    if (enabled && !client.stripeDefaultPaymentMethodId) {
      return error(
        "Nessuna carta registrata per il cliente: invia prima la richiesta di attivazione.",
        400,
      );
    }

    // Data di fine addebito comune (solo in attivazione, opzionale).
    let autoChargeEndDate: Date | null | undefined;
    if (enabled) {
      autoChargeEndDate =
        typeof body?.autoChargeEndDate === "string" && body.autoChargeEndDate
          ? new Date(body.autoChargeEndDate)
          : null;
    }

    const count = await setClientAutoChargeEnabled(client.id, enabled, {
      autoChargeEndDate,
    });

    return json({ ok: true, enabled, updated: count });
  });
}
