"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Bottone di eliminazione con conferma esplicita in due passaggi (pannello
 * inline, niente window.confirm). Gestisce il 409 (conflitto) mostrando il
 * messaggio dell'API. A eliminazione riuscita reindirizza a `redirectTo`.
 */
export function DeleteButton({
  endpoint,
  redirectTo,
  entityLabel,
  className = "btn-danger",
}: {
  endpoint: string;
  redirectTo: string;
  entityLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Eliminazione non riuscita");
        setPending(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Errore di rete durante l'eliminazione");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => setConfirming(true)}
      >
        Elimina
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm text-red-800">
          Eliminare definitivamente {entityLabel}? L&apos;azione non è
          reversibile.
        </p>
        {error ? (
          <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-danger"
            disabled={pending}
            onClick={handleDelete}
          >
            {pending ? "Eliminazione…" : "Sì, elimina"}
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
    </div>
  );
}
