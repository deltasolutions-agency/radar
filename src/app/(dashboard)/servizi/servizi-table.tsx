"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ServiceTypeBadge, ActiveBadge } from "@/components/badges";
import { formatMoney } from "@/lib/format";
import {
  BILLING_PERIOD_LABELS,
  type ServiceTypeValue,
  type BillingPeriodValue,
} from "@/lib/validations";

export type ServiceRow = {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  currency: string;
  billingPeriod: string;
  customPeriodDays: number | null;
  active: boolean;
};

/**
 * Lista servizi con ricerca istantanea client-side (nessun submit): filtra per
 * nome servizio sui dati già in pagina (già eventualmente filtrati per tipo).
 */
export function ServiziTable({ services }: { services: ServiceRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per nome servizio…"
        className="field w-full max-w-md"
        aria-label="Cerca servizi"
      />

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {services.length === 0 ? (
              <>
                Nessun servizio.{" "}
                <Link href="/servizi/nuovo" className="text-brand underline">
                  Creane uno
                </Link>
                .
              </>
            ) : (
              "Nessun servizio corrisponde alla ricerca."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Tipo</th>
                  <th className="px-5 py-3 font-medium">Prezzo</th>
                  <th className="px-5 py-3 font-medium">Periodicità</th>
                  <th className="px-5 py-3 font-medium">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-line-soft transition last:border-0 hover:bg-canvas"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/servizi/${s.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <ServiceTypeBadge type={s.type as ServiceTypeValue} />
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {formatMoney(s.priceCents, s.currency)}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {
                        BILLING_PERIOD_LABELS[
                          s.billingPeriod as BillingPeriodValue
                        ]
                      }
                      {s.billingPeriod === "PERSONALIZZATA" && s.customPeriodDays
                        ? ` (${s.customPeriodDays}gg)`
                        : ""}
                    </td>
                    <td className="px-5 py-3">
                      <ActiveBadge active={s.active} />
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
