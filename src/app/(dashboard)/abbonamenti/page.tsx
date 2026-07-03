import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SubscriptionStatusBadge } from "@/components/badges";
import { DeleteButton } from "@/components/delete-button";
import { CeaseButton } from "./cease-button";
import { formatEur, formatDate } from "@/lib/format";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

// Scadenzario: una riga per servizio (SubscriptionItem), ordinata per scadenza.
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

  const items = await prisma.subscriptionItem.findMany({
    where: status ? { status } : undefined,
    include: {
      service: true,
      subscription: { include: { client: true } },
      _count: { select: { paymentItems: true } },
    },
    orderBy: { endDate: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abbonamenti</h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length} {items.length === 1 ? "servizio" : "servizi"}
            {status ? ` · ${SUBSCRIPTION_STATUS_LABELS[status]}` : ""}
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

      <div className="card overflow-hidden">
        {items.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessun servizio.{" "}
            <Link href="/abbonamenti/nuovo" className="text-brand underline">
              Crea un abbonamento
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left mono-label">
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Servizio</th>
                <th className="px-5 py-3 font-medium">Scadenza</th>
                <th className="px-5 py-3 font-medium">Prezzo</th>
                <th className="px-5 py-3 font-medium">Stato</th>
                <th className="px-5 py-3 font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const client = it.subscription.client;
                const clientName = client.ragioneSociale?.trim()
                  ? client.ragioneSociale
                  : client.name;
                return (
                  <tr
                    key={it.id}
                    className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/abbonamenti/${it.subscriptionId}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {it.service.name}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {formatDate(it.endDate)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {formatEur(it.priceCents, it.currency)}
                    </td>
                    <td className="px-5 py-3">
                      <SubscriptionStatusBadge
                        status={it.status as SubscriptionStatusValue}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/abbonamenti/${it.subscriptionId}`}
                          className="text-brand hover:underline"
                        >
                          Dettaglio
                        </Link>
                        {it.status === "CESSATO" ? null : it._count
                            .paymentItems === 0 ? (
                          <DeleteButton
                            endpoint={`/api/subscription-items/${it.id}`}
                            redirectTo="/abbonamenti"
                            entityLabel="questo servizio"
                            className="text-xs font-medium text-red-600 hover:underline"
                          />
                        ) : (
                          <CeaseButton
                            itemId={it.id}
                            status={it.status}
                            className="text-xs font-medium text-slate-600 hover:underline"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
