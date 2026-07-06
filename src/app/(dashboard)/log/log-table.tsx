"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type LogChange = { label: string; from: string; to: string };

export type LogRow = {
  id: string;
  createdAt: string; // già formattato (data+ora)
  clientId: string;
  clientName: string;
  changes: LogChange[];
  ipAddress: string | null;
};

/**
 * Log delle modifiche ai dati di fatturazione, sola lettura. Ricerca istantanea
 * client-side per nome cliente sui dati già in pagina.
 */
export function LogTable({ rows }: { rows: LogRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.clientName.toLowerCase().includes(q));
  }, [rows, query]);

  const dash = (v: string) => (v.trim() ? v : "—");

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per cliente…"
        className="field w-full max-w-md"
        aria-label="Cerca nei log per cliente"
      />

      <p className="text-sm text-slate-500">
        {filtered.length} {filtered.length === 1 ? "voce" : "voci"}
        {query.trim() ? ` per "${query.trim()}"` : ""}
      </p>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {rows.length === 0
              ? "Nessuna modifica registrata."
              : "Nessuna voce corrisponde alla ricerca."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Modifiche</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-line-soft align-top transition last:border-0 hover:bg-canvas"
                  >
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                      {r.createdAt}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/clienti/${r.clientId}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {r.clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <ul className="space-y-1">
                        {r.changes.map((c, i) => (
                          <li key={i} className="text-xs">
                            <span className="font-medium text-ink">
                              {c.label}
                            </span>
                            <span className="text-slate-400"> · </span>
                            <span className="text-slate-400 line-through">
                              {dash(c.from)}
                            </span>
                            <span className="text-slate-400"> → </span>
                            <span className="text-ink">{dash(c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">
                      {r.ipAddress ?? "—"}
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
