"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ActivationStateBadge, SubscriptionStatusBadge } from "@/components/badges";
import type { SubscriptionActivationState } from "@prisma/client";
import { formatDate } from "@/lib/format";
import type { SubscriptionStatusValue } from "@/lib/validations";

export type SubscriptionRow = {
  subscriptionId: string;
  clientId: string;
  /** Creato dalla console Delta Cloud (abbonamento separato del Cloud). */
  consoleManaged: boolean;
  createdISO: string;
  clientName: string;
  services: string[];
  /** Clienti finali distinti delle righe (per sottotitolo e ricerca). */
  endClients: string[];
  /** Stato del contenitore: uno stato noto, oppure "MISTO" se le righe divergono. */
  status: string;
  /** Scadenza più imminente (ISO) tra i servizi attivi; null se non applicabile. */
  nextDueISO: string | null;
  /** Note del contenitore (Subscription.notes); null/"" se assenti. */
  notes: string | null;
  /** Non ACTIVE → badge "In attesa di pagamento" / "Annullato" al posto dello stato. */
  activationState: SubscriptionActivationState;
};

export type ClientRow = {
  clientId: string;
  clientName: string;
  subs: SubscriptionRow[];
  /** Scadenza più imminente tra tutti i suoi abbonamenti. */
  nextDueISO: string | null;
};

/** Nome breve dell'abbonamento dentro il gruppo del cliente. */
function subLabel(r: SubscriptionRow): string {
  return r.consoleManaged ? "Cloud" : "Servizi";
}

/** Stato del gruppo: unico se tutti gli abbonamenti concordano, altrimenti misto. */
function StatusCell({ subs }: { subs: SubscriptionRow[] }) {
  const tokens = new Set(subs.map((r) => (r.activationState !== "ACTIVE" ? r.activationState : r.status)));
  if (tokens.size > 1) {
    return (
      <span className="inline-flex items-center rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-slate-600">
        Misto
      </span>
    );
  }
  const r = subs[0];
  if (r.activationState !== "ACTIVE") return <ActivationStateBadge state={r.activationState} />;
  if (r.status === "MISTO") {
    return (
      <span className="inline-flex items-center rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-slate-600">
        Misto
      </span>
    );
  }
  return <SubscriptionStatusBadge status={r.status as SubscriptionStatusValue} />;
}

function ServicesCell({ subs }: { subs: SubscriptionRow[] }) {
  const services = subs.flatMap((r) => r.services);
  const endClients = [...new Set(subs.flatMap((r) => r.endClients))];
  return (
    <>
      <span title={services.join(", ")}>{compactServices(services)}</span>
      {endClients.length > 0 ? (
        <span className="block font-mono text-xs text-slate-500" title={endClients.join(", ")}>
          Cliente finale: {compactEndClients(endClients)}
        </span>
      ) : null}
    </>
  );
}

function NotesCell({ notes }: { notes: string | null }) {
  return notes?.trim() ? (
    <span title={notes} className="inline-flex items-center gap-1.5">
      <NoteIcon />
      {truncateNote(notes)}
    </span>
  ) : (
    <span className="text-slate-400">—</span>
  );
}

/**
 * Lista abbonamenti RAGGRUPPATA per cliente (una riga per cliente; se ha più
 * abbonamenti, la riga si apre e mostra ciascuno) con ricerca
 * istantanea client-side su nome cliente, nome servizio e cliente finale
 * (nessun submit).
 */
export function AbbonamentiTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        c.subs.some(
          (r) =>
            r.services.some((s) => s.toLowerCase().includes(q)) ||
            r.endClients.some((s) => s.toLowerCase().includes(q)) ||
            (q === "cloud" && r.consoleManaged),
        ),
    );
  }, [clients, query]);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per cliente, servizio o cliente finale…"
        className="field w-full max-w-md"
        aria-label="Cerca abbonamenti"
      />

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {clients.length === 0 ? (
              <>
                Nessun abbonamento.{" "}
                <Link href="/abbonamenti/nuovo" className="text-brand underline">
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
                {filtered.map((c) => {
                  const single = c.subs.length === 1 ? c.subs[0] : null;
                  const isOpen = open.has(c.clientId);
                  const notes = c.subs.map((r) => r.notes?.trim()).find(Boolean) ?? null;
                  return (
                    <Fragment key={c.clientId}>
                      <tr className="border-b border-line-soft transition last:border-0 hover:bg-canvas">
                        <td className="px-5 py-3">
                          {single ? (
                            <Link href={`/abbonamenti/${single.subscriptionId}`} className="font-medium text-ink hover:underline">
                              {c.clientName}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggle(c.clientId)}
                              aria-expanded={isOpen}
                              className="inline-flex items-center gap-2 text-left font-medium text-ink hover:underline"
                            >
                              <span
                                aria-hidden="true"
                                className={`inline-block text-xs text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                              >
                                ▶
                              </span>
                              {c.clientName}
                            </button>
                          )}
                          {single?.consoleManaged ? <CloudChip /> : null}
                          {!single ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {c.subs.length} abbonamenti: {c.subs.map(subLabel).join(", ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          <ServicesCell subs={c.subs} />
                        </td>
                        <td className="px-5 py-3 text-slate-600">{c.nextDueISO ? formatDate(new Date(c.nextDueISO)) : "—"}</td>
                        <td className="px-5 py-3">
                          <StatusCell subs={c.subs} />
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          <NotesCell notes={notes} />
                        </td>
                        <td className="px-5 py-3">
                          {single ? (
                            <Link href={`/abbonamenti/${single.subscriptionId}`} className="text-brand hover:underline">
                              Dettaglio
                            </Link>
                          ) : (
                            <button type="button" onClick={() => toggle(c.clientId)} className="text-brand hover:underline">
                              {isOpen ? "Chiudi" : "Apri"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {!single && isOpen
                        ? c.subs.map((r) => (
                            <tr key={r.subscriptionId} className="border-b border-line-soft bg-canvas/50 last:border-0">
                              <td className="py-2.5 pl-12 pr-5">
                                <Link href={`/abbonamenti/${r.subscriptionId}`} className="font-medium text-ink hover:underline">
                                  {subLabel(r)}
                                </Link>
                                <span className="ml-2 text-xs text-slate-500">dal {formatDate(new Date(r.createdISO))}</span>
                              </td>
                              <td className="px-5 py-2.5 text-slate-600">
                                <ServicesCell subs={[r]} />
                              </td>
                              <td className="px-5 py-2.5 text-slate-600">{r.nextDueISO ? formatDate(new Date(r.nextDueISO)) : "—"}</td>
                              <td className="px-5 py-2.5">
                                <StatusCell subs={[r]} />
                              </td>
                              <td className="px-5 py-2.5 text-slate-600">
                                <NotesCell notes={r.notes} />
                              </td>
                              <td className="px-5 py-2.5">
                                <Link href={`/abbonamenti/${r.subscriptionId}`} className="text-brand hover:underline">
                                  Dettaglio
                                </Link>
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CloudChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-violet-700">
      Cloud
    </span>
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

function compactEndClients(names: string[]): string {
  return names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")}… (+${names.length - 2})`;
}
