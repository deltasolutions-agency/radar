"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Storna un pagamento Stripe confermato (conferma inline in due passaggi).
 * Se il pagamento aveva rinnovato l'abbonamento ed è l'ultimo confermato, il
 * backend disfa il rinnovo; qui lo comunichiamo. Su 409 (pagamenti successivi)
 * mostra il messaggio ricevuto senza alcuna azione automatica.
 */
export function RefundButton({
  paymentId,
  amountLabel,
  previousEndDateLabel,
}: {
  paymentId: string;
  amountLabel: string;
  previousEndDateLabel: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRefund() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/refund`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Storno non riuscito");
        setConfirming(false);
        setPending(false);
        return;
      }
      setNotice(
        body.renewalReverted && previousEndDateLabel
          ? `Rinnovo annullato, scadenza ripristinata al ${previousEndDateLabel}.`
          : "Pagamento stornato.",
      );
      setConfirming(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  if (notice) {
    return <span className="text-xs text-violet-700">{notice}</span>;
  }

  if (error && !confirming) {
    return (
      <span className="block max-w-[15rem] text-xs text-red-600">{error}</span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="text-xs text-brand hover:underline"
        onClick={() => setConfirming(true)}
      >
        Storna
      </button>
    );
  }

  return (
    <div className="max-w-[16rem] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs leading-relaxed text-amber-800">
        Confermi lo storno di {amountLabel}?
        {previousEndDateLabel
          ? ` Se questo pagamento aveva rinnovato l'abbonamento, la scadenza tornerà al ${previousEndDateLabel}.`
          : ""}{" "}
        Questa azione non è reversibile.
      </p>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700">{error}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
          disabled={pending}
          onClick={handleRefund}
        >
          {pending ? "Storno…" : "Sì, storna"}
        </button>
        <button
          type="button"
          className="rounded border border-line bg-white px-2 py-1 text-xs text-ink transition hover:bg-canvas disabled:opacity-60"
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
