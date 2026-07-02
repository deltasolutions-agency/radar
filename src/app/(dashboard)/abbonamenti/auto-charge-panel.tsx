"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pannello rinnovo automatico sul dettaglio abbonamento:
 * - se la carta non è ancora registrata → avvia il SetupIntent (redirect Stripe);
 * - se la carta c'è ma l'addebito è disattivo → form di attivazione (+ data fine);
 * - se attivo → badge di stato + disattivazione.
 */
export function AutoChargePanel({
  subscriptionId,
  hasCard,
  autoChargeEnabled,
  autoChargeEndDateInput,
  autoChargeEndDateLabel,
}: {
  subscriptionId: string;
  hasCard: boolean;
  autoChargeEnabled: boolean;
  autoChargeEndDateInput: string;
  autoChargeEndDateLabel: string | null;
}) {
  const router = useRouter();
  const [endDate, setEndDate] = useState(autoChargeEndDateInput);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSetup() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/setup-auto-charge`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setError(body.error ?? "Avvio registrazione carta non riuscito");
        setPending(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  async function patch(data: Record<string, unknown>, okThen?: () => void) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Operazione non riuscita");
        setPending(false);
        return;
      }
      okThen?.();
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  // ── Attivo ────────────────────────────────────────────────────────────────
  if (autoChargeEnabled) {
    return (
      <div className="space-y-2">
        <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          Rinnovo automatico attivo
          {autoChargeEndDateLabel ? ` · fino al ${autoChargeEndDateLabel}` : ""}
        </span>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div>
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline disabled:opacity-60"
            disabled={pending}
            onClick={() => patch({ autoChargeEnabled: false })}
          >
            Disattiva rinnovo automatico
          </button>
        </div>
      </div>
    );
  }

  // ── Carta non registrata ────────────────────────────────────────────────
  if (!hasCard) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Per attivare il rinnovo automatico registra la carta del cliente su
          Stripe.
        </p>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={startSetup}
        >
          {pending ? "Apertura…" : "Attiva rinnovo automatico"}
        </button>
      </div>
    );
  }

  // ── Carta registrata, addebito disattivo → form di attivazione ────────────
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Carta registrata. Puoi attivare l&apos;addebito automatico alla cadenza
        dell&apos;abbonamento.
      </p>
      <div>
        <label htmlFor="autoChargeEndDate" className="field-label">
          Data di fine addebito automatico (opzionale)
        </label>
        <input
          id="autoChargeEndDate"
          type="date"
          className="field"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          patch({
            autoChargeEnabled: true,
            autoChargeEndDate: endDate || null,
          })
        }
      >
        {pending ? "Attivazione…" : "Attiva addebito automatico"}
      </button>
    </div>
  );
}
