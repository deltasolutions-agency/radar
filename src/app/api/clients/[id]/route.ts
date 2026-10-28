import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, error, withApi, requireSession } from "@/lib/api";
import { clientUpdateSchema } from "@/lib/validations";
import { getStripe } from "@/lib/stripe";
import { langOf, stripeLocale } from "@/lib/i18n";

type Params = { params: { id: string } };

// GET /api/clients/[id]
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const client = await prisma.client.findUnique({
      where: { id: params.id },
    });
    if (!client) return error("Cliente non trovato", 404);
    return json({ client });
  });
}

// PATCH /api/clients/[id]
export function PATCH(req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const exists = await prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, locale: true },
    });
    if (!exists) return error("Cliente non trovato", 404);

    const data = clientUpdateSchema.parse(await req.json());
    const client = await prisma.client.update({
      where: { id: params.id },
      data,
    });

    // Lingua cambiata: allinea preferred_locales del Customer Stripe (email e
    // ricevute Stripe). Un errore Stripe NON blocca il salvataggio.
    if (data.locale && data.locale !== exists.locale && client.stripeCustomerId) {
      try {
        await getStripe().customers.update(client.stripeCustomerId, {
          preferred_locales: [stripeLocale(langOf(client.locale))],
        });
      } catch (err) {
        console.error(
          `[clients] aggiornamento preferred_locales Stripe fallito per ${client.id}:`,
          err,
        );
      }
    }
    return json({ client });
  });
}

// DELETE /api/clients/[id]
export function DELETE(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const client = await prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { subscriptions: true } } },
    });
    if (!client) return error("Cliente non trovato", 404);

    // Blocco la cancellazione se esistono abbonamenti collegati (Fase 4).
    if (client._count.subscriptions > 0) {
      return error(
        "Impossibile eliminare: il cliente ha abbonamenti collegati. " +
          "Rimuovi prima gli abbonamenti.",
        409,
      );
    }

    await prisma.client.delete({ where: { id: params.id } });
    return json({ ok: true });
  });
}
