import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientStatusBadge } from "@/components/badges";
import { DeleteButton } from "@/components/delete-button";
import { formatDate } from "@/lib/format";
import type { ClientStatusValue } from "@/lib/validations";
import { RequestDataUpdateButton } from "./request-data-update-button";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="mono-label w-40 shrink-0 sm:pt-0.5">{label}</dt>
      <dd className="text-sm text-ink">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

export default async function ClienteDettaglioPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: { _count: { select: { subscriptions: true } } },
  });
  if (!client) notFound();

  const address = [
    client.indirizzo,
    [client.cap, client.citta].filter(Boolean).join(" "),
    [client.provincia, client.paese].filter(Boolean).join(" "),
  ]
    .filter((p) => p && p.trim())
    .join(", ");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clienti" className="text-sm text-slate-500 hover:underline">
          ← Clienti
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {client.name}
            </h1>
            <ClientStatusBadge status={client.status as ClientStatusValue} />
          </div>
          <div className="flex items-center gap-2">
            <RequestDataUpdateButton clientId={client.id} />
            <Link href={`/clienti/${client.id}/modifica`} className="btn-ghost">
              Modifica
            </Link>
            <DeleteButton
              endpoint={`/api/clients/${client.id}`}
              redirectTo="/clienti"
              entityLabel={`il cliente "${client.name}"`}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mono-label mb-3">Contatto</h2>
          <dl>
            <Row label="Nome / Referente" value={client.name} />
            <Row label="Email" value={client.email} />
            <Row label="Telefono" value={client.phone} />
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="mono-label mb-3">Fatturazione</h2>
          <dl>
            <Row label="Ragione sociale" value={client.ragioneSociale} />
            <Row label="Partita IVA" value={client.partitaIva} />
            <Row label="Codice fiscale" value={client.codiceFiscale} />
            <Row label="Indirizzo" value={address} />
            <Row label="Codice SDI" value={client.sdi} />
            <Row label="PEC" value={client.pec} />
          </dl>
        </section>
      </div>

      {client.note?.trim() ? (
        <section className="card p-6">
          <h2 className="mono-label mb-3">Note</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{client.note}</p>
        </section>
      ) : null}

      <p className="font-mono text-xs text-slate-400">
        id {client.id} · creato {formatDate(client.createdAt)} ·{" "}
        {client._count.subscriptions} abbonamenti
      </p>
    </div>
  );
}
