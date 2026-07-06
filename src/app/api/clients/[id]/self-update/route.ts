import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi } from "@/lib/api";
import { clientSelfUpdateSchema } from "@/lib/validations";
import {
  CLIENT_DATA_FIELDS,
  CLIENT_DATA_FIELD_LABELS,
  pickClientData,
  diffClientData,
  type ClientDataFieldKey,
} from "@/lib/client-data";
import { clientIp } from "@/lib/request-ip";
import { sendEmail } from "@/lib/send-email";
import { buildClientDataChangeEmail } from "@/lib/email-templates";

type Params = { params: { id: string } };

// PATCH /api/clients/[id]/self-update
// Modifica self-service dei dati di fatturazione dalla pagina pubblica.
// Auth: NON sessione admin, ma dataEditToken (body.token o ?token=).
// Consuma la possibilità di modifica: dopo il salvataggio dataEditUnlocked=false
// finché l'admin non invia una nuova richiesta di aggiornamento.
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    const body = await req.json().catch(() => ({}));
    const token =
      (typeof body?.token === "string" ? body.token : null) ??
      req.nextUrl.searchParams.get("token");

    if (!token) return error("Token mancante", 401);

    const client = await prisma.client.findUnique({
      where: { id: params.id },
    });
    if (!client || client.dataEditToken !== token) {
      return error("Link non valido", 404);
    }

    if (!client.dataEditUnlocked) {
      return error("Modifica non disponibile, richiedi un nuovo link", 403);
    }

    // Valida i soli campi modificabili (email esclusa).
    const parsed = clientSelfUpdateSchema.parse(body);

    // Snapshot prima/dopo e diff (solo campi effettivamente cambiati).
    const before = pickClientData(client);
    const after = { ...before };
    for (const { key } of CLIENT_DATA_FIELDS) {
      const v = parsed[key];
      if (v !== undefined) after[key] = v;
    }
    const changes = diffClientData(before, after);

    // Nessuna modifica reale: non consumo lo sblocco, non registro, non notifico.
    if (Object.keys(changes).length === 0) {
      return json({ ok: true, message: "Nessuna modifica da salvare" });
    }

    // Applica subito + consuma lo sblocco + registra il log, in transazione.
    await prisma.$transaction([
      prisma.client.update({
        where: { id: client.id },
        data: { ...parsed, dataEditUnlocked: false },
      }),
      prisma.clientDataChangeLog.create({
        data: {
          clientId: client.id,
          changedBy: "client",
          changes,
          ipAddress: clientIp(),
        },
      }),
    ]);

    // Notifica all'admin col diff leggibile (fuori transazione, non bloccante).
    try {
      const clientName = client.ragioneSociale?.trim()
        ? client.ragioneSociale
        : client.name;
      const readable = (Object.keys(changes) as ClientDataFieldKey[]).map(
        (key) => ({
          label: CLIENT_DATA_FIELD_LABELS[key],
          from: changes[key].from,
          to: changes[key].to,
        }),
      );
      const content = buildClientDataChangeEmail({
        clientName,
        clientId: client.id,
        changes: readable,
        ipAddress: clientIp(),
      });
      await sendEmail(content, process.env.ADMIN_EMAIL);
    } catch (e) {
      console.error(
        `[self-update] notifica admin fallita (client ${client.id}):`,
        e,
      );
    }

    return json({ ok: true, message: "Dati aggiornati" });
  });
}
