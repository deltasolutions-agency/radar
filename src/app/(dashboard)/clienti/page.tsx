import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ClientStatusBadge } from "@/components/badges";
import type { ClientStatusValue } from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function ClientiPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const search = searchParams.search?.trim();

  const clients = await prisma.client.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { ragioneSociale: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clienti</h1>
          <p className="mt-1 text-sm text-slate-500">
            {clients.length}{" "}
            {clients.length === 1 ? "cliente" : "clienti"}
            {search ? ` per "${search}"` : ""}
          </p>
        </div>
        <Link href="/clienti/nuovo" className="btn-primary">
          + Nuovo cliente
        </Link>
      </div>

      <form className="flex gap-2" action="/clienti">
        <input
          type="search"
          name="search"
          defaultValue={search ?? ""}
          placeholder="Cerca per nome, email o ragione sociale…"
          className="field max-w-md"
        />
        <button type="submit" className="btn-ghost">
          Cerca
        </button>
        {search ? (
          <Link href="/clienti" className="btn-ghost">
            Azzera
          </Link>
        ) : null}
      </form>

      <div className="card overflow-hidden">
        {clients.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessun cliente.{" "}
            <Link href="/clienti/nuovo" className="text-brand underline">
              Creane uno
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left mono-label">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Telefono</th>
                <th className="px-5 py-3 font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/clienti/${c.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.ragioneSociale ? (
                      <div className="text-xs text-slate-500">
                        {c.ragioneSociale}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.email}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {c.phone ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    <ClientStatusBadge
                      status={c.status as ClientStatusValue}
                    />
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
