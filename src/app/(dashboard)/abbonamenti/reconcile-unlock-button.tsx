"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Sblocca una riga "da riconciliare" (solo admin), con conferma semplice. */
export function ReconcileUnlockButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock() {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/subscription-items/${itemId}/reconcile-unlock`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? "Sblocco non riuscito");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setErr("Errore di rete");
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Sbloccare la riga? Fallo dopo aver registrato il rinnovo o gestito il
            pagamento rimasto in attesa.
          </span>
          <button type="button" className="btn-primary" disabled={pending} onClick={unlock}>
            {pending ? "Sblocco…" : "Conferma"}
          </button>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Annulla
          </button>
        </div>
      ) : (
        <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
          Sblocca
        </button>
      )}
      {err ? <p className="text-sm text-red-700">{err}</p> : null}
    </div>
  );
}
