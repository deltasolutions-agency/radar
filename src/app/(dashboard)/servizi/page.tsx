import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ServiceTypeBadge, ActiveBadge } from "@/components/badges";
import { formatMoney } from "@/lib/format";
import {
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  BILLING_PERIOD_LABELS,
  type ServiceTypeValue,
  type BillingPeriodValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function ServiziPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const type =
    searchParams.type &&
    SERVICE_TYPES.includes(searchParams.type as ServiceTypeValue)
      ? (searchParams.type as ServiceTypeValue)
      : undefined;

  const services = await prisma.service.findMany({
    where: type ? { type } : undefined,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servizi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Catalogo riusabile · {services.length}{" "}
            {services.length === 1 ? "servizio" : "servizi"}
            {type ? ` · ${SERVICE_TYPE_LABELS[type]}` : ""}
          </p>
        </div>
        <Link href="/servizi/nuovo" className="btn-primary">
          + Nuovo servizio
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/servizi"
          className={!type ? "btn-primary" : "btn-ghost"}
        >
          Tutti
        </Link>
        {SERVICE_TYPES.map((t) => (
          <Link
            key={t}
            href={`/servizi?type=${t}`}
            className={type === t ? "btn-primary" : "btn-ghost"}
          >
            {SERVICE_TYPE_LABELS[t]}
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        {services.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessun servizio.{" "}
            <Link href="/servizi/nuovo" className="text-brand underline">
              Creane uno
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left mono-label">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Prezzo</th>
                <th className="px-5 py-3 font-medium">Periodicità</th>
                <th className="px-5 py-3 font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/servizi/${s.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <ServiceTypeBadge type={s.type as ServiceTypeValue} />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {formatMoney(s.priceCents, s.currency)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {BILLING_PERIOD_LABELS[s.billingPeriod as BillingPeriodValue]}
                    {s.billingPeriod === "PERSONALIZZATA" && s.customPeriodDays
                      ? ` (${s.customPeriodDays}gg)`
                      : ""}
                  </td>
                  <td className="px-5 py-3">
                    <ActiveBadge active={s.active} />
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
