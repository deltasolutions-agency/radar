import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { error, json, withApi, requireAdmin } from "@/lib/api";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";
import { dayFromYmd, ledgerUpdateSchema, ymdOfDay } from "@/lib/ledger";
import { romeYmd } from "@/lib/rome-time";

type Ctx = { params: { id: string } };

// PATCH /api/ledger/:id — modifica campi e/o segna pagato / riapre. Solo admin.
export function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const current = await prisma.ledgerEntry.findUnique({ where: { id: params.id } });
    if (!current) return error("Voce non trovata", 404);
    const d = ledgerUpdateSchema.parse(await req.json());

    const data: Prisma.LedgerEntryUpdateInput = {};
    if (d.counterparty !== undefined) data.counterparty = d.counterparty;
    if (d.description !== undefined) data.description = d.description;
    if (d.amountCents !== undefined) data.amountCents = d.amountCents;
    if (d.notes !== undefined) data.notes = d.notes;

    // Scadenza cambiata: gli alert ripartono dalla nuova data.
    if (d.dueDate !== undefined) {
      const next = d.dueDate ? dayFromYmd(d.dueDate) : null;
      if (ymdOfDay(next) !== ymdOfDay(current.dueDate)) {
        data.dueDate = next;
        data.lastAlertAt = null;
        data.alertCount = 0;
      }
    }

    if (d.paid === true) {
      data.paidAt = dayFromYmd(d.paidDate ?? romeYmd(new Date()));
      if (d.paidNote !== undefined) data.paidNote = d.paidNote;
    } else if (d.paid === false) {
      // Riaperto: data e nota del pagamento si cancellano, gli alert ripartono.
      data.paidAt = null;
      data.paidNote = null;
      data.lastAlertAt = null;
      data.alertCount = 0;
    }

    const entry = await prisma.ledgerEntry.update({ where: { id: params.id }, data });
    return json({ entry });
  });
}

// DELETE /api/ledger/:id — eliminazione definitiva, conferma testuale "ELIMINA".
export function DELETE(req: Request, { params }: Ctx) {
  return withApi(async () => {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { confirmText?: string };
    if ((body.confirmText ?? "").trim() !== DELETE_CONFIRM_WORD) {
      return error(`Scrivi ${DELETE_CONFIRM_WORD} per confermare`, 400);
    }
    const res = await prisma.ledgerEntry.deleteMany({ where: { id: params.id } });
    if (res.count === 0) return error("Voce non trovata", 404);
    return json({ ok: true });
  });
}
