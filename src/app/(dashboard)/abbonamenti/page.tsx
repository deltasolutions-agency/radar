import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SubscriptionStatusBadge } from "@/components/badges";
import { formatEur, formatDate } from "@/lib/format";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatusValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

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

  const subscriptions = await prisma.subscription.findMany({
    where: status ? { status } : undefined,
    include: { client: true, service: true },
    orderBy: { endDate: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abbonamenti</h1>
          <p className="mt-1 text-sm text-slate-500">
            {subscriptions.length}{" "}
            {subscriptions.length === 1 ? "abbonamento" : "abbonamenti"}
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
        {subscriptions.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessun abbonamento.{" "}
            <Link href="/abbonamenti/nuovo" className="text-brand underline">
              Creane uno
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
              {subscriptions.map((sub) => (
                <tr
                  key={sub.id}
                  className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/abbonamenti/${sub.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {sub.client.ragioneSociale?.trim()
                        ? sub.client.ragioneSociale
                        : sub.client.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {sub.service.name}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {formatDate(sub.endDate)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {formatEur(sub.priceCents, sub.currency)}
                  </td>
                  <td className="px-5 py-3">
                    <SubscriptionStatusBadge
                      status={sub.status as SubscriptionStatusValue}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/abbonamenti/${sub.id}`}
                      className="text-brand hover:underline"
                    >
                      Dettaglio
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
