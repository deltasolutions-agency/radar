"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PREFERRED_METHODS, PREFERRED_METHOD_LABELS, type PreferredMethod } from "@/lib/preferred-payment";

/**
 * Modifica dei metadati del contenitore abbonamento: metodo di pagamento
 * preferito e note.
 * I servizi si gestiscono come righe dal dettaglio; qui niente prezzi/scadenze.
 */
export function SubscriptionNotesForm({
  subscriptionId,
  initialNotes,
  initialMethod,
  autoChargeItems,
  serviceFeeEnabled,
}: {
  subscriptionId: string;
  initialNotes: string;
  initialMethod: PreferredMethod;
  /** Righe con rinnovo automatico su carta attivo. */
  autoChargeItems: number;
  serviceFeeEnabled: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [method, setMethod] = useState<PreferredMethod>(initialMethod);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || undefined, preferredPaymentMethod: method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Salvataggio non riuscito");
        setPending(false);
        return;
      }
      router.push(`/abbonamenti/${subscriptionId}`);
      router.refresh();
    } catch {
      setError("Errore di rete durante il salvataggio");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <section className="card space-y-3 p-6">
        <h2 className="mono-label">Metodo di pagamento preferito</h2>
        <div role="radiogroup" aria-label="Metodo di pagamento preferito" className="grid gap-2 sm:grid-cols-3">
          {PREFERRED_METHODS.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-sm font-medium ${
                method === m ? "border-brand ring-1 ring-brand" : "border-line"
              }`}
            >
              <input type="radio" name="preferredMethod" checked={method === m} onChange={() => setMethod(m)} />
              {PREFERRED_METHOD_LABELS[m]}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {method === "CARTA"
            ? "Con la carta restano attivi link \"Paga ora\", costi di servizio e rinnovo automatico."
            : "Bonifico o contanti: le funzioni della carta si nascondono e i pagamenti li registri tu."}
        </p>
        {method !== "CARTA" && initialMethod === "CARTA" && (autoChargeItems > 0 || serviceFeeEnabled) ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {serviceFeeEnabled ? "I costi di servizio (1,5%) verranno disattivati. " : ""}
            {autoChargeItems > 0
              ? `${autoChargeItems} ${autoChargeItems === 1 ? "servizio ha" : "servizi hanno"} il rinnovo automatico su carta attivo: resta attivo finché non lo spegni dalla modifica del servizio.`
              : ""}
          </p>
        ) : null}
      </section>
      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Note abbonamento</h2>
        <textarea
          rows={4}
          className="field"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva modifiche"}
        </button>
        <Link href={`/abbonamenti/${subscriptionId}`} className="btn-ghost">
          Annulla
        </Link>
      </div>
    </form>
  );
}
