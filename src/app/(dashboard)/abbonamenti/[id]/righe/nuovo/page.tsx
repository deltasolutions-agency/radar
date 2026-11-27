import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ItemForm } from "../../../item-form";
import { PREFERRED_METHOD_LABELS, manualMethodFor } from "@/lib/preferred-payment";
import { getEndClientSuggestions } from "@/lib/end-client";

export const dynamic = "force-dynamic";

export default async function NuovaRigaPage({
  params,
}: {
  params: { id: string };
}) {
  const sub = await prisma.subscription.findUnique({
    where: { id: params.id },
    include: { client: true },
  });
  if (!sub) notFound();

  const clientName = sub.client.ragioneSociale?.trim()
    ? sub.client.ragioneSociale
    : sub.client.name;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/abbonamenti/${sub.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← {clientName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Aggiungi servizio
        </h1>
      </div>
      <ItemForm
        mode="create"
        subscriptionId={sub.id}
        allowAutoCharge={sub.preferredPaymentMethod === "CARTA"}
        paidOption={
          sub.activationState === "ACTIVE" && !sub.consoleManaged
            ? {
                defaultMethod: sub.preferredPaymentMethod === "CARTA" ? "Carta" : manualMethodFor(sub.preferredPaymentMethod),
                preferredLabel: PREFERRED_METHOD_LABELS[sub.preferredPaymentMethod],
              }
            : undefined
        }
        endClientSuggestions={await getEndClientSuggestions(sub.clientId)}
      />
    </div>
  );
}
