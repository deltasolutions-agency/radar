"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Riattiva l'accesso pubblico a una ricevuta scaduta (finestra 10gg da ora).
 * Azione manuale dell'admin. Dopo il successo aggiorna i dati con router.refresh().
 */
export function ReactivateButton({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Riattivazione non riuscita");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="text-brand hover:underline disabled:opacity-60"
        disabled={pending}
        onClick={handleClick}
      >
        {pending ? "Riattivo…" : "Riattiva accesso"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
