"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Stato del rinnovo automatico per UN singolo servizio (SubscriptionItem), con
 * disattivazione INDIPENDENTE per quella riga (non cumulativa). Mostrato solo se
 * autoChargeEnabled è true.
 */
export function AutoChargeItemBadge({
  itemId,
  periodicityLabel,
  autoChargeEndDateLabel,
}: {
  itemId: string;
  periodicityLabel: string;
  autoChargeEndDateLabel: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function disable() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscription-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoChargeEnabled: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Disattivazione non riuscita");
        setPending(false);
        return;
      }
      setConfirming(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        Rinnovo automatico attivo
      </span>
      <p className="text-sm text-ink">
        Addebito automatico {periodicityLabel.toLowerCase()} ·{" "}
        {autoChargeEndDateLabel
          ? `fino al ${autoChargeEndDateLabel}`
          : "nessuna scadenza"}
      </p>

      {!confirming ? (
        <>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Disattiva rinnovo automatico
          </button>
        </>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            Confermi la disattivazione del rinnovo automatico{" "}
            <strong>solo per questo servizio</strong>? La carta resta salvata.
          </p>
          {error ? (
            <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={pending}
              onClick={disable}
            >
              {pending ? "Disattivazione…" : "Sì, disattiva"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
