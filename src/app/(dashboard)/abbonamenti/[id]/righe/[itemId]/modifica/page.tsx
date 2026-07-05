import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ItemForm } from "../../../../item-form";

export const dynamic = "force-dynamic";

/** Centesimi → stringa euro (1250 → "12.50"). */
function centsToEuro(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Date → "YYYY-MM-DD" per gli input type=date. */
function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ModificaRigaPage({
  params,
}: {
  params: { id: string; itemId: string };
}) {
  const item = await prisma.subscriptionItem.findUnique({
    where: { id: params.itemId },
    include: { service: true, subscription: { include: { client: true } } },
  });
  if (!item || item.subscriptionId !== params.id) notFound();

  const clientName = item.subscription.client.ragioneSociale?.trim()
    ? item.subscription.client.ragioneSociale
    : item.subscription.client.name;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/abbonamenti/${params.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← {clientName} · {item.service.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Modifica servizio
        </h1>
      </div>
      <ItemForm
        mode="edit"
        subscriptionId={params.id}
        itemId={item.id}
        initial={{
          serviceId: item.serviceId,
          startDate: toDateInput(item.startDate),
          endDate: toDateInput(item.endDate),
          priceEuro: centsToEuro(item.priceCents),
          quantity: String(item.quantity),
          billingPeriod: item.billingPeriod,
          customPeriodDays: item.customPeriodDays?.toString() ?? "",
          autoChargeEnabled: item.autoChargeEnabled,
          autoChargeEndDate: item.autoChargeEndDate
            ? toDateInput(item.autoChargeEndDate)
            : "",
          notes: item.notes ?? "",
        }}
      />
    </div>
  );
}
