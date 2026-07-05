"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClientStatusBadge } from "@/components/badges";
import type { ClientStatusValue } from "@/lib/validations";

export type ClientRow = {
  id: string;
  name: string;
  ragioneSociale: string | null;
  email: string;
  phone: string | null;
  status: string;
};

/**
 * Lista clienti con ricerca istantanea client-side (nessun submit): filtra
 * mentre si digita su nome referente e ragione sociale, sui dati già in pagina.
 */
export function ClientiTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.ragioneSociale?.toLowerCase().includes(q) ?? false),
    );
  }, [clients, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per nome o ragione sociale…"
        className="field w-full max-w-md"
        aria-label="Cerca clienti"
      />

      <p className="text-sm text-slate-500">
        {filtered.length} {filtered.length === 1 ? "cliente" : "clienti"}
        {query.trim() ? ` per "${query.trim()}"` : ""}
      </p>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {clients.length === 0 ? (
              <>
                Nessun cliente.{" "}
                <Link href="/clienti/nuovo" className="text-brand underline">
                  Creane uno
                </Link>
                .
              </>
            ) : (
              "Nessun cliente corrisponde alla ricerca."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Telefono</th>
                  <th className="px-5 py-3 font-medium">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
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
                      <ClientStatusBadge status={c.status as ClientStatusValue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
