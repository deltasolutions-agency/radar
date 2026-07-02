import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ServiceTypeBadge, ActiveBadge } from "@/components/badges";
import { DeleteButton } from "@/components/delete-button";
import { formatMoney, formatDate } from "@/lib/format";
import {
  BILLING_PERIOD_LABELS,
  type ServiceTypeValue,
  type BillingPeriodValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="mono-label w-40 shrink-0 sm:pt-0.5">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

export default async function ServizioDettaglioPage({
  params,
}: {
  params: { id: string };
}) {
  const service = await prisma.service.findUnique({
    where: { id: params.id },
    include: { _count: { select: { subscriptions: true } } },
  });
  if (!service) notFound();

  const margin = service.priceCents - service.costCents;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/servizi" className="text-sm text-slate-500 hover:underline">
          ← Servizi
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {service.name}
            </h1>
            <ServiceTypeBadge type={service.type as ServiceTypeValue} />
            <ActiveBadge active={service.active} />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/servizi/${service.id}/modifica`}
              className="btn-ghost"
            >
              Modifica
            </Link>
            <DeleteButton
              endpoint={`/api/services/${service.id}`}
              redirectTo="/servizi"
              entityLabel={`il servizio "${service.name}"`}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mono-label mb-3">Dettagli</h2>
          <dl>
            <Row label="Tipo" value={service.type} />
            <Row
              label="Descrizione"
              value={service.description?.trim() ? service.description : "—"}
            />
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="mono-label mb-3">Economia & rinnovo</h2>
          <dl>
            <Row
              label="Prezzo"
              value={formatMoney(service.priceCents, service.currency)}
            />
            <Row
              label="Costo"
              value={formatMoney(service.costCents, service.currency)}
            />
            <Row
              label="Margine"
              value={formatMoney(margin, service.currency)}
            />
            <Row
              label="Periodicità"
              value={
                BILLING_PERIOD_LABELS[
                  service.billingPeriod as BillingPeriodValue
                ] +
                (service.billingPeriod === "PERSONALIZZATA" &&
                service.customPeriodDays
                  ? ` (${service.customPeriodDays} giorni)`
                  : "")
              }
            />
            <Row
              label="Rinnovo auto"
              value={service.autoRenew ? "Sì" : "No"}
            />
            <Row
              label="Incremento rinnovo"
              value={
                service.renewalIncreasePercent > 0
                  ? `+${service.renewalIncreasePercent}%`
                  : "—"
              }
            />
          </dl>
        </section>
      </div>

      <p className="font-mono text-xs text-slate-400">
        id {service.id} · creato {formatDate(service.createdAt)} ·{" "}
        {service._count.subscriptions} abbonamenti
      </p>
    </div>
  );
}
