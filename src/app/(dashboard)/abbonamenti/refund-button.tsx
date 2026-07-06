"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatEur } from "@/lib/format";

export type RefundableItem = {
  id: string;
  serviceName: string;
  amountCents: number;
  currency: string;
  /** Scadenza a cui tornerebbe la riga se stornata (null = nessun rinnovo). */
  previousEndDateLabel: string | null;
};

/**
 * Storna un pagamento Stripe confermato, per intero o solo alcune righe
 * (storno parziale). Conferma inline con selezione delle righe da stornare
 * (default = tutte). Per ogni riga stornata che aveva rinnovato la scadenza, il
 * backend la ripristina. Su 409 (rinnovi successivi) mostra il messaggio.
 */
export function RefundButton({
  paymentId,
  items,
  serviceFeeCents = 0,
}: {
  paymentId: string;
  items: RefundableItem[];
  /**
   * Costo di servizio ancora rimborsabile su questo pagamento (residuo: totale
   * meno quanto già reso da storni precedenti). La quota proporzionale mostrata
   * nel riepilogo è calcolata sul rapporto tra righe selezionate e righe ancora
   * stornabili, coerente col backend.
   */
  serviceFeeCents?: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((it) => [it.id, true])),
  );

  const selectedItems = items.filter((it) => selected[it.id]);
  const total = selectedItems.reduce((s, it) => s + it.amountCents, 0);
  const currency = items[0]?.currency ?? "eur";
  const isTotal = selectedItems.length === items.length;

  // Quota proporzionale del costo di servizio che verrà rimborsata insieme alle
  // righe selezionate (stessa formula del backend: proporzione sul residuo).
  const refundableTotal = items.reduce((s, it) => s + it.amountCents, 0);
  const refundServiceFee =
    serviceFeeCents <= 0 || selectedItems.length === 0
      ? 0
      : isTotal
        ? serviceFeeCents
        : refundableTotal > 0
          ? Math.round(serviceFeeCents * (total / refundableTotal))
          : 0;
  const grandTotal = total + refundServiceFee;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function handleRefund() {
    if (selectedItems.length === 0) {
      setError("Seleziona almeno una riga da stornare");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Storno totale → nessun paymentItemIds; parziale → righe selezionate.
        body: JSON.stringify(
          isTotal ? {} : { paymentItemIds: selectedItems.map((it) => it.id) },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Storno non riuscito");
        setPending(false);
        return;
      }
      const reverted = body.itemsReverted ?? 0;
      setNotice(
        reverted > 0
          ? `Storno eseguito. Rinnovo annullato su ${reverted} ${
              reverted === 1 ? "riga" : "righe"
            }.`
          : "Storno eseguito.",
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

  if (!confirming) {
    return (
      <button
        type="button"
        className="text-xs text-brand hover:underline"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
      >
        Storna
      </button>
    );
  }

  return (
    <div className="max-w-[18rem] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="mb-1.5 text-xs font-medium text-amber-800">
        Righe da stornare
      </p>
      <div className="space-y-1">
        {items.map((it) => (
          <label
            key={it.id}
            className="flex items-center justify-between gap-2 text-xs text-amber-900"
          >
            <span className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!selected[it.id]}
                onChange={() => toggle(it.id)}
              />
              {it.serviceName}
              {it.previousEndDateLabel ? (
                <span className="text-amber-700">
                  → {it.previousEndDateLabel}
                </span>
              ) : null}
            </span>
            <span className="font-mono">
              {formatEur(it.amountCents, it.currency)}
            </span>
          </label>
        ))}
      </div>
      {refundServiceFee > 0 ? (
        <div className="mt-2 space-y-0.5 border-t border-amber-200 pt-1.5 text-xs text-amber-900">
          <div className="flex items-center justify-between">
            <span>Servizi selezionati</span>
            <span className="font-mono">{formatEur(total, currency)}</span>
          </div>
          <div className="flex items-center justify-between text-amber-700">
            <span>+ Costi di servizio (quota proporzionale)</span>
            <span className="font-mono">
              {formatEur(refundServiceFee, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between font-medium text-amber-900">
            <span>Totale rimborsato</span>
            <span className="font-mono">{formatEur(grandTotal, currency)}</span>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-amber-800">
        Storno {isTotal ? "totale" : "parziale"} di{" "}
        <span className="font-mono font-medium">
          {formatEur(grandTotal, currency)}
        </span>
        . Le righe con una scadenza indicata torneranno a quella data. Azione non
        reversibile.
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
