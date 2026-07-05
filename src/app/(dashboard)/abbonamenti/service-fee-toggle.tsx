"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Toggle sempre visibile per il costo di servizio 1,5% (Subscription.serviceFeeEnabled).
 * Salva IMMEDIATAMENTE al cambio (PATCH diretta, senza pulsante "Salva"), con
 * conferma visiva breve ("Salvato").
 */
export function ServiceFeeToggle({
  subscriptionId,
  initialEnabled,
}: {
  subscriptionId: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: boolean) {
    // Aggiornamento ottimistico; rollback in caso di errore.
    setEnabled(next);
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceFeeEnabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEnabled(!next);
        setError(body.error ?? "Salvataggio non riuscito");
        setPending(false);
        return;
      }
      setPending(false);
      setSaved(true);
      router.refresh();
      // Nascondi la conferma dopo un paio di secondi.
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setEnabled(!next);
      setError("Errore di rete");
      setPending(false);
    }
  }

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2.5">
        <span className="relative inline-block h-6 w-11 shrink-0">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={pending}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand peer-disabled:opacity-60" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
        <span className="text-sm text-ink">
          {enabled ? "Attivi" : "Disattivi"}
        </span>
        {pending ? (
          <span className="text-xs text-slate-400">Salvataggio…</span>
        ) : saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Salvato
          </span>
        ) : null}
      </label>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : null}
      <p className="mt-1 text-xs text-slate-500">
        Se attivo, aggiunge un costo di servizio dell&apos;1,5% ai pagamenti
        Stripe di questo abbonamento.
      </p>
    </div>
  );
}
