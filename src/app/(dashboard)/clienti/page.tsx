import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ClientiTable } from "./clienti-table";

export const dynamic = "force-dynamic";

export default async function ClientiPage() {
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ragioneSociale: true,
      email: true,
      phone: true,
      status: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clienti</h1>
          <p className="mt-1 text-sm text-slate-500">Anagrafica clienti</p>
        </div>
        <Link href="/clienti/nuovo" className="btn-primary">
          + Nuovo cliente
        </Link>
      </div>

      <ClientiTable clients={clients} />
    </div>
  );
}
