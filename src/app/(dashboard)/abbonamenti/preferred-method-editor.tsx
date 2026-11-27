"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PREFERRED_METHODS, PREFERRED_METHOD_LABELS, type PreferredMethod } from "@/lib/preferred-payment";

/** Metodo di pagamento preferito, modificabile direttamente dalla scheda. */
export function PreferredMethodEditor({
  subscriptionId,
  initial,
  autoChargeItems,
}: {
  subscriptionId: string;
  initial: PreferredMethod;
  /** Righe con rinnovo automatico su carta attivo (avviso se si lascia la carta). */
  autoChargeItems: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<PreferredMethod | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function choose(m: PreferredMethod) {
    if (m === initial) return;
    setBusy(m);
    setErr(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredPaymentMethod: m }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error ?? "Salvataggio non riuscito");
      else router.refresh();
    } catch {
      setErr("Errore di rete, riprova");
    }
    setBusy(null);
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Metodo di pagamento preferito" className="inline-flex overflow-hidden rounded-lg border border-line">
        {PREFERRED_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={initial === m}
            disabled={busy !== null}
            onClick={() => choose(m)}
            className={
              initial === m
                ? "bg-ink px-3.5 py-1.5 text-sm font-medium text-white"
                : "bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-canvas"
            }
          >
            {busy === m ? "…" : PREFERRED_METHOD_LABELS[m]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {initial === "CARTA"
          ? "Con la carta: link \"Paga ora\", costi di servizio e rinnovo automatico."
          : "Funzioni della carta nascoste: i pagamenti li registri tu."}
        {initial !== "CARTA" && autoChargeItems > 0
          ? ` Attenzione: ${autoChargeItems} ${autoChargeItems === 1 ? "servizio ha" : "servizi hanno"} ancora il rinnovo automatico su carta attivo; spegnilo dalla modifica del servizio se non serve più.`
          : ""}
      </p>
      {err ? <p className="mt-1 text-sm font-medium text-red-700">{err}</p> : null}
    </div>
  );
}
