import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AbbonamentiTable, type ClientRow, type SubscriptionRow } from "./abbonamenti-table";
import { ACTIVE_SUBSCRIPTION_WHERE } from "@/lib/activation-state";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

// Righe non più "attive" ai fini della prossima scadenza del contenitore.
const CLOSED_STATUSES = new Set(["CESSATO"]);

// Lista abbonamenti raggruppata per cliente: una riga per cliente, con dentro
// i suoi abbonamenti (es. quello dei servizi e quello del Cloud dalla console).
export default async function AbbonamentiPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  // Filtro speciale: abbonamenti in attesa del primo pagamento.
  const pendingOnly = searchParams.status === "IN_ATTESA_PAGAMENTO";
  const status =
    searchParams.status &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(searchParams.status)
      ? (searchParams.status as SubscriptionStatusValue)
      : undefined;

  // Un contenitore compare nel filtro se ALMENO UNA delle sue righe è in quello
  // stato; mostriamo comunque TUTTE le sue righe.
  // Gli stati delle righe valgono solo per gli abbonamenti attivi.
  const subscriptions = await prisma.subscription.findMany({
    where: pendingOnly
      ? { activationState: "PENDING_FIRST_PAYMENT" }
      : status
        ? { items: { some: { status } }, ...ACTIVE_SUBSCRIPTION_WHERE }
        : undefined,
    include: {
      client: { select: { name: true, ragioneSociale: true } },
      items: {
        select: {
          status: true,
          endDate: true,
          endClientName: true,
          service: { select: { name: true } },
        },
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
    const endClients = [
      ...new Set(
        sub.items
          .map((it) => it.endClientName)
          .filter((n): n is string => !!n),
      ),
    ];

    // Stato del contenitore: unico se tutte le righe concordano, altrimenti MISTO.
    const distinctStatuses = new Set(sub.items.map((it) => it.status));
    const status =
      sub.items.length === 0
        ? "MISTO"
        : distinctStatuses.size === 1
          ? [...distinctStatuses][0]
          : "MISTO";

    // Prossima scadenza: la più imminente tra le righe non cessate (solo per
    // gli abbonamenti attivi).
    const openEndDates = (sub.activationState === "ACTIVE" ? sub.items : [])
      .filter((it) => !CLOSED_STATUSES.has(it.status))
      .map((it) => it.endDate.getTime());
    const nextDueISO =
      openEndDates.length > 0
        ? new Date(Math.min(...openEndDates)).toISOString()
        : null;

    return {
      subscriptionId: sub.id,
      clientId: sub.clientId,
      consoleManaged: sub.consoleManaged,
      createdISO: sub.createdAt.toISOString(),
      clientName,
      services,
      endClients,
      status,
      nextDueISO,
      notes: sub.notes ?? null,
      activationState: sub.activationState,
    };
  });

  // Raggruppa per cliente; dentro, abbonamenti dal più vecchio.
  const byClient = new Map<string, SubscriptionRow[]>();
  for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  const due = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);
  const clients: ClientRow[] = [...byClient.entries()].map(([clientId, subs]) => {
    subs.sort((a, b) => a.createdISO.localeCompare(b.createdISO));
    const next = Math.min(...subs.map((r) => due(r.nextDueISO)));
    return {
      clientId,
      clientName: subs[0].clientName,
      subs,
      nextDueISO: Number.isFinite(next) ? new Date(next).toISOString() : null,
    };
  });
  // Ordina i clienti per scadenza più imminente (senza scadenza in fondo).
  clients.sort((a, b) => due(a.nextDueISO) - due(b.nextDueISO));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abbonamenti</h1>
          <p className="mt-1 text-sm text-slate-500">
            {clients.length} {clients.length === 1 ? "cliente" : "clienti"} · {rows.length}{" "}
            {rows.length === 1 ? "abbonamento" : "abbonamenti"}
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
          className={!status && !pendingOnly ? "btn-primary" : "btn-ghost"}
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
        <Link
          href="/abbonamenti?status=IN_ATTESA_PAGAMENTO"
          className={pendingOnly ? "btn-primary" : "btn-ghost"}
        >
          In attesa di pagamento
        </Link>
      </div>

      <AbbonamentiTable clients={clients} />
    </div>
  );
}
