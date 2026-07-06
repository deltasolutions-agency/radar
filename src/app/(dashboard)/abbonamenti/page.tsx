import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AbbonamentiTable, type SubscriptionRow } from "./abbonamenti-table";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

// Righe non più "attive" ai fini della prossima scadenza del contenitore.
const CLOSED_STATUSES = new Set(["CESSATO"]);

// Lista abbonamenti AGGREGATA per cliente/contenitore: una riga per Subscription.
export default async function AbbonamentiPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status =
    searchParams.status &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(searchParams.status)
      ? (searchParams.status as SubscriptionStatusValue)
      : undefined;

  // Un contenitore compare nel filtro se ALMENO UNA delle sue righe è in quello
  // stato; mostriamo comunque TUTTE le sue righe.
  const subscriptions = await prisma.subscription.findMany({
    where: status ? { items: { some: { status } } } : undefined,
    include: {
      client: { select: { name: true, ragioneSociale: true } },
      items: {
        select: { status: true, endDate: true, service: { select: { name: true } } },
        orderBy: { endDate: "asc" },
      },
    },
  });
  // NB: Subscription.notes è incluso di default (scalare) nel record.

  const rows: SubscriptionRow[] = subscriptions.map((sub) => {
    const clientName = sub.client.ragioneSociale?.trim()
      ? sub.client.ragioneSociale
      : sub.client.name;

    const services = sub.items.map((it) => it.service.name);

    // Stato del contenitore: unico se tutte le righe concordano, altrimenti MISTO.
    const distinctStatuses = new Set(sub.items.map((it) => it.status));
    const status =
      sub.items.length === 0
        ? "MISTO"
        : distinctStatuses.size === 1
          ? [...distinctStatuses][0]
          : "MISTO";

    // Prossima scadenza: la più imminente tra le righe non cessate.
    const openEndDates = sub.items
      .filter((it) => !CLOSED_STATUSES.has(it.status))
      .map((it) => it.endDate.getTime());
    const nextDueISO =
      openEndDates.length > 0
        ? new Date(Math.min(...openEndDates)).toISOString()
        : null;

    return {
      subscriptionId: sub.id,
      clientName,
      services,
      status,
      nextDueISO,
      notes: sub.notes ?? null,
    };
  });

  // Ordina i contenitori per scadenza più imminente (senza scadenza in fondo).
  rows.sort((a, b) => {
    const ta = a.nextDueISO
      ? new Date(a.nextDueISO).getTime()
      : Number.POSITIVE_INFINITY;
    const tb = b.nextDueISO
      ? new Date(b.nextDueISO).getTime()
      : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abbonamenti</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} {rows.length === 1 ? "cliente" : "clienti"}
            {status ? ` · con servizi ${SUBSCRIPTION_STATUS_LABELS[status]}` : ""}
          </p>
        </div>
        <Link href="/abbonamenti/nuovo" className="btn-primary">
          + Nuovo abbonamento
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/abbonamenti"
          className={!status ? "btn-primary" : "btn-ghost"}
        >
          Tutti
        </Link>
        {SUBSCRIPTION_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/abbonamenti?status=${s}`}
            className={status === s ? "btn-primary" : "btn-ghost"}
          >
            {SUBSCRIPTION_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <AbbonamentiTable rows={rows} />
    </div>
  );
}
