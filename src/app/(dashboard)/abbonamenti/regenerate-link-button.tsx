"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rigenera e reinvia il link di pagamento Stripe scaduto: marca il vecchio
 * Payment come FALLITO e ne crea uno nuovo con nuovo link inviato al cliente.
 */
export function RegenerateLinkButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/regenerate-link`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Rigenerazione non riuscita");
        setPending(false);
        return;
      }
      if (!body.sent) {
        setError("Link creato ma invio email non riuscito.");
      } else {
        setDone(true);
      }
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  if (done) {
    return <span className="text-xs text-emerald-700">Nuovo link inviato</span>;
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        className="text-left text-brand hover:underline disabled:opacity-60"
        disabled={pending}
        onClick={handleClick}
      >
        {pending ? "Rigenero…" : "Rigenera e rinvia link"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
