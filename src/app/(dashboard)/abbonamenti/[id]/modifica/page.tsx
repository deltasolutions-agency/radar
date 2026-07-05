import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SubscriptionNotesForm } from "../../subscription-notes-form";

export const dynamic = "force-dynamic";

export default async function ModificaAbbonamentoPage({
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
          Modifica abbonamento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          I servizi (prezzi, scadenze, rinnovo automatico) si gestiscono come
          righe dal dettaglio dell&apos;abbonamento.
        </p>
      </div>
      <SubscriptionNotesForm
        subscriptionId={sub.id}
        initialNotes={sub.notes ?? ""}
        initialServiceFeeEnabled={sub.serviceFeeEnabled}
      />
    </div>
  );
}
