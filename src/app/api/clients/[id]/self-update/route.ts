import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { json, withApi } from "@/lib/api";
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

/**
 * Codici stabili restituiti al form pubblico, che li traduce nella lingua della
 * pagina. `message` (italiano, invariato) resta per retrocompatibilità.
 */
export type SelfUpdateErrorCode =
  | "TOKEN_MISSING"
  | "INVALID_LINK"
  | "EDIT_LOCKED"
  | "INVALID_DATA"
  | "INVALID_PEC"
  | "INTERNAL";
export type SelfUpdateSuccessCode = "UPDATED" | "NO_CHANGES";
/** Codice per singolo campo in `fieldCodes` (con INVALID_DATA). */
export type SelfUpdateFieldCode = "INVALID_PEC" | "TOO_LONG" | "INVALID";

function fail(
  code: SelfUpdateErrorCode,
  message: string,
  status: number,
  extra?: {
    details?: Record<string, string>;
    fieldCodes?: Record<string, SelfUpdateFieldCode>;
  },
) {
  return json({ error: code, message, ...extra }, status);
}

/** Errori Zod → messaggi italiani (details, come prima) + codici per campo. */
function zodFields(err: ZodError): {
  details: Record<string, string>;
  fieldCodes: Record<string, SelfUpdateFieldCode>;
} {
  const details: Record<string, string> = {};
  const fieldCodes: Record<string, SelfUpdateFieldCode> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (details[key]) continue;
    details[key] = issue.message;
    fieldCodes[key] =
      issue.code === "too_big"
        ? "TOO_LONG"
        : key === "pec"
          ? "INVALID_PEC"
          : "INVALID";
  }
  return { details, fieldCodes };
}

// PATCH /api/clients/[id]/self-update
// Modifica self-service dei dati di fatturazione dalla pagina pubblica.
// Auth: NON sessione admin, ma dataEditToken (body.token o ?token=).
// Consuma la possibilità di modifica: dopo il salvataggio dataEditUnlocked=false
// finché l'admin non invia una nuova richiesta di aggiornamento.
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    try {
      return await handle(req, params);
    } catch (e) {
      if (e instanceof ZodError) {
        const fields = zodFields(e);
        // Solo la PEC non valida → codice dedicato; altrimenti generico.
        const keys = Object.keys(fields.details);
        const code =
          keys.length === 1 && fields.fieldCodes.pec === "INVALID_PEC"
            ? "INVALID_PEC"
            : "INVALID_DATA";
        return fail(code, "Dati non validi", 400, fields);
      }
      console.error("[self-update] errore non gestito:", e);
      return fail("INTERNAL", "Errore interno", 500);
    }
  });
}

async function handle(req: NextRequest, params: Params["params"]) {
  const body = await req.json().catch(() => ({}));
  const token =
    (typeof body?.token === "string" ? body.token : null) ??
    req.nextUrl.searchParams.get("token");

  if (!token) return fail("TOKEN_MISSING", "Token mancante", 401);

  const client = await prisma.client.findUnique({
    where: { id: params.id },
  });
  if (!client || client.dataEditToken !== token) {
    return fail("INVALID_LINK", "Link non valido", 404);
  }

  if (!client.dataEditUnlocked) {
    return fail(
      "EDIT_LOCKED",
      "Modifica non disponibile, richiedi un nuovo link",
      403,
    );
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
    return json({
      ok: true,
      code: "NO_CHANGES" satisfies SelfUpdateSuccessCode,
      message: "Nessuna modifica da salvare",
    });
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
    await sendEmail(content, process.env.ADMIN_EMAIL, {
      type: "DATA_CHANGE_NOTICE",
      trigger: "CLIENT",
      clientId: client.id,
    });
  } catch (e) {
    console.error(
      `[self-update] notifica admin fallita (client ${client.id}):`,
      e,
    );
  }

  return json({
    ok: true,
    code: "UPDATED" satisfies SelfUpdateSuccessCode,
    message: "Dati aggiornati",
  });
}
