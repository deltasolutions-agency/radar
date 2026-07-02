import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SubscriptionForm } from "../../subscription-form";

export const dynamic = "force-dynamic";

/** Centesimi → stringa euro (1250 → "12.50"). */
function centsToEuro(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Date → "YYYY-MM-DD" per gli input type=date. */
function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ModificaAbbonamentoPage({
  params,
}: {
  params: { id: string };
}) {
  const sub = await prisma.subscription.findUnique({
    where: { id: params.id },
    include: { client: true, service: true },
  });
  if (!sub) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/abbonamenti/${sub.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← {sub.client.name} · {sub.service.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Modifica abbonamento
        </h1>
      </div>
      <SubscriptionForm
        mode="edit"
        initial={{
          id: sub.id,
          clientId: sub.clientId,
          serviceId: sub.serviceId,
          startDate: toDateInput(sub.startDate),
          endDate: toDateInput(sub.endDate),
          priceEuro: centsToEuro(sub.priceCents),
          billingPeriod: sub.billingPeriod,
          customPeriodDays: sub.customPeriodDays?.toString() ?? "",
          paymentMethod: sub.paymentMethod,
          autoRenew: sub.autoRenew,
          note: sub.note ?? "",
        }}
      />
    </div>
  );
}
