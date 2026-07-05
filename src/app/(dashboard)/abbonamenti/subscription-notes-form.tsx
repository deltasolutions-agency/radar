"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Modifica dei metadati del contenitore abbonamento (attualmente solo le note).
 * I servizi si gestiscono come righe dal dettaglio; qui niente prezzi/scadenze.
 */
export function SubscriptionNotesForm({
  subscriptionId,
  initialNotes,
  initialServiceFeeEnabled,
}: {
  subscriptionId: string;
  initialNotes: string;
  initialServiceFeeEnabled: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(
    initialServiceFeeEnabled,
  );
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
        body: JSON.stringify({ notes: notes || undefined, serviceFeeEnabled }),
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
      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Note abbonamento</h2>
        <textarea
          rows={4}
          className="field"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="mono-label">Costi di servizio</h2>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={serviceFeeEnabled}
            onChange={(e) => setServiceFeeEnabled(e.target.checked)}
          />
          <span>
            Applica costi di servizio (1,5%)
            <span className="mt-0.5 block text-xs text-slate-500">
              Aggiunge una commissione dell&apos;1,5% sul totale ai soli
              pagamenti con carta (Stripe): checkout self-service e addebito
              automatico. I pagamenti manuali non sono interessati.
            </span>
          </span>
        </label>
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
