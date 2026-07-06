import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { ensureDataEditToken, billingDataFor } from "@/lib/client-data";
import { sendEmail } from "@/lib/send-email";
import { buildDataUpdateRequestEmail } from "@/lib/email-templates";

type Params = { params: { id: string } };

// POST /api/clients/[id]/request-data-update
// Admin: chiede al cliente di verificare/aggiornare i propri dati.
//  - Sblocca la modifica (dataEditUnlocked = true) anche se già consumata.
//  - Genera dataEditToken se assente.
//  - Invia al cliente la mail con la sezione dati + link + disclaimer.
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();

    const client = await prisma.client.findUnique({
      where: { id: params.id },
    });
    if (!client) return error("Cliente non trovato", 404);
    if (!client.email) {
      return error("Il cliente non ha un'email a cui inviare la richiesta", 400);
    }

    // Sblocca la modifica e assicura il token.
    await prisma.client.update({
      where: { id: client.id },
      data: { dataEditUnlocked: true },
    });
    const token = await ensureDataEditToken(client);

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      return error(
        "Configurazione mancante (APP_URL): impossibile generare il link",
        500,
      );
    }
    const dataEditUrl = `${appUrl}/i-tuoi-dati/${token}`;

    const clientName = client.ragioneSociale?.trim()
      ? client.ragioneSociale
      : client.name;
    const content = buildDataUpdateRequestEmail({
      clientName,
      billingData: billingDataFor(client),
      dataEditUrl,
    });
    const sent = await sendEmail(content, client.email);
    if (sent.status !== "INVIATA") {
      return error(
        `Invio non riuscito: ${sent.error ?? "errore sconosciuto"}`,
        502,
      );
    }

    return json({ ok: true, email: client.email });
  });
}
