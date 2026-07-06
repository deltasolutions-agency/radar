"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SubscriptionStatusBadge } from "@/components/badges";
import { formatDate } from "@/lib/format";
import type { SubscriptionStatusValue } from "@/lib/validations";

export type SubscriptionRow = {
  subscriptionId: string;
  clientName: string;
  services: string[];
  /** Stato del contenitore: uno stato noto, oppure "MISTO" se le righe divergono. */
  status: string;
  /** Scadenza più imminente (ISO) tra i servizi attivi; null se non applicabile. */
  nextDueISO: string | null;
  /** Note del contenitore (Subscription.notes); null/"" se assenti. */
  notes: string | null;
};

/**
 * Lista abbonamenti AGGREGATA per cliente (una riga per contenitore) con ricerca
 * istantanea client-side su nome cliente e nome servizio (nessun submit).
 */
export function AbbonamentiTable({ rows }: { rows: SubscriptionRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.clientName.toLowerCase().includes(q) ||
        r.services.some((s) => s.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per cliente o servizio…"
        className="field w-full max-w-md"
        aria-label="Cerca abbonamenti"
      />

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {rows.length === 0 ? (
              <>
                Nessun abbonamento.{" "}
                <Link
                  href="/abbonamenti/nuovo"
                  className="text-brand underline"
                >
                  Crea un abbonamento
                </Link>
                .
              </>
            ) : (
              "Nessun abbonamento corrisponde alla ricerca."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Servizi</th>
                  <th className="px-5 py-3 font-medium">Prossima scadenza</th>
                  <th className="px-5 py-3 font-medium">Stato</th>
                  <th className="px-5 py-3 font-medium">Note</th>
                  <th className="px-5 py-3 font-medium">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.subscriptionId}
                    className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/abbonamenti/${r.subscriptionId}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {r.clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      <span title={r.services.join(", ")}>
                        {compactServices(r.services)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.nextDueISO ? formatDate(new Date(r.nextDueISO)) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {r.status === "MISTO" ? (
                        <span className="inline-flex items-center rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-slate-600">
                          Misto
                        </span>
                      ) : (
                        <SubscriptionStatusBadge
                          status={r.status as SubscriptionStatusValue}
                        />
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.notes?.trim() ? (
                        <span
                          title={r.notes}
                          className="inline-flex items-center gap-1.5"
                        >
                          <NoteIcon />
                          {truncateNote(r.notes)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/abbonamenti/${r.subscriptionId}`}
                        className="text-brand hover:underline"
                      >
                        Dettaglio
                      </Link>
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

/** "Hosting, Dominio, SSL (3)"; con molti servizi mostra i primi 3 + conteggio. */
function compactServices(services: string[]): string {
  if (services.length === 0) return "—";
  if (services.length <= 3) {
    return `${services.join(", ")} (${services.length})`;
  }
  return `${services.slice(0, 3).join(", ")}… (${services.length})`;
}

/** Tronca la nota a ~35 caratteri (il testo completo resta nel title). */
function truncateNote(note: string): string {
  const t = note.trim();
  return t.length > 35 ? `${t.slice(0, 35).trimEnd()}…` : t;
}

/** Icona nota, coerente con quella usata nello storico pagamenti. */
function NoteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-slate-400"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
