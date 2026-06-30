import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ServiceForm } from "../../service-form";

export const dynamic = "force-dynamic";

/** Centesimi → stringa euro per il form (1250 → "12.50"). */
function centsToEuro(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default async function ModificaServizioPage({
  params,
}: {
  params: { id: string };
}) {
  const service = await prisma.service.findUnique({
    where: { id: params.id },
  });
  if (!service) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/servizi/${service.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← {service.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Modifica servizio
        </h1>
      </div>
      <ServiceForm
        mode="edit"
        initial={{
          id: service.id,
          name: service.name,
          type: service.type,
          description: service.description ?? "",
          priceEuro: centsToEuro(service.priceCents),
          costEuro: centsToEuro(service.costCents),
          billingPeriod: service.billingPeriod,
          customPeriodDays: service.customPeriodDays?.toString() ?? "",
          autoRenew: service.autoRenew,
          active: service.active,
        }}
      />
    </div>
  );
}
