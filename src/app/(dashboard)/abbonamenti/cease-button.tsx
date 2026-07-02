"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Bottone "Cessa abbonamento" con conferma inline in due passaggi.
 * Consentito solo dagli stati ATTIVO / IN_SCADENZA / SCADUTO: negli altri casi
 * il componente non renderizza nulla.
 */
export function CeaseButton({
  id,
  status,
  className = "btn-ghost",
}: {
  id: string;
  status: string;
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ceasable = ["ATTIVO", "IN_SCADENZA", "SCADUTO"].includes(status);
  if (!ceasable) return null;

  async function handleCease() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${id}/cease`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Operazione non riuscita");
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

  if (!confirming) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => setConfirming(true)}
      >
        Cessa
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm text-amber-800">
        Cessare questo abbonamento? Lo stato diventerà CESSATO.
      </p>
      {error ? (
        <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={handleCease}
        >
          {pending ? "Attendere…" : "Sì, cessa"}
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
  );
}
