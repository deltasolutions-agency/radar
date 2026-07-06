"use client";

import { useState } from "react";

/**
 * Bottone admin: chiede al cliente di verificare i propri dati di fatturazione.
 * Sblocca la modifica self-service e invia la mail col link. Mostra conferma
 * inline con l'indirizzo a cui è stata inviata la richiesta.
 */
export function RequestDataUpdateButton({ clientId }: { clientId: string }) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/request-data-update`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Invio non riuscito");
        setPending(false);
        return;
      }
      setNotice(`Richiesta inviata a ${body.email}`);
      setPending(false);
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  if (notice) {
    return <span className="text-sm text-emerald-700">{notice}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        onClick={handleClick}
      >
        {pending ? "Invio…" : "Richiedi conferma dati"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
