import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientForm } from "../../client-form";

export const dynamic = "force-dynamic";

export default async function ModificaClientePage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({ where: { id: params.id } });
  if (!client) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clienti/${client.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← {client.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Modifica cliente
        </h1>
      </div>
      <ClientForm
        mode="edit"
        initial={{
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone ?? "",
          ragioneSociale: client.ragioneSociale ?? "",
          partitaIva: client.partitaIva ?? "",
          codiceFiscale: client.codiceFiscale ?? "",
          indirizzo: client.indirizzo ?? "",
          citta: client.citta ?? "",
          cap: client.cap ?? "",
          provincia: client.provincia ?? "",
          paese: client.paese ?? "IT",
          status: client.status,
          note: client.note ?? "",
        }}
      />
    </div>
  );
}
