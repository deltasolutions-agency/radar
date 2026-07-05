"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEur, formatDate } from "@/lib/format";
import { computeServiceFeeCents } from "@/lib/service-fee";

export type PayableItem = {
  id: string;
  serviceName: string;
  priceCents: number; // prezzo unitario
  quantity: number; // ≥ 1
  currency: string;
  status: string;
  /** Scadenza corrente della riga (YYYY-MM-DD), per segnalare scadenze diverse. */
  endDate: string;
};

/**
 * Azioni di pagamento sul dettaglio abbonamento. L'admin seleziona quali righe
 * (servizi) coprire; le righe selezionate vengono raggruppate in un unico
 * Payment/addebito:
 * - "Registra pagamento manuale": form inline → POST /pay-manual
 * - "Invia link" / "Apri checkout": Stripe Checkout con una line per servizio.
 */
export function PaymentActions({
  subscriptionId,
  items,
  serviceFeeEnabled,
}: {
  subscriptionId: string;
  items: PayableItem[];
  serviceFeeEnabled: boolean;
}) {
  const router = useRouter();

  // Selezione righe: default = tutte le righe pagabili (non cessate).
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((it) => [it.id, true])),
  );

  const [showManual, setShowManual] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [manualPending, setManualPending] = useState(false);

  const [stripePending, setStripePending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedItems = useMemo(
    () => items.filter((it) => selected[it.id]),
    [items, selected],
  );
  const selectedIds = selectedItems.map((it) => it.id);
  const totalCents = selectedItems.reduce(
    (s, it) => s + it.priceCents * it.quantity,
    0,
  );
  const currency = selectedItems[0]?.currency ?? "eur";

  // Costo di servizio 1,5%: si applica SOLO ai pagamenti con carta (Stripe).
  const serviceFeeCents = computeServiceFeeCents(totalCents, serviceFeeEnabled);
  const stripeTotalCents = totalCents + serviceFeeCents;

  // Valute diverse → un unico addebito non è possibile (blocco).
  const mixedCurrency =
    new Set(selectedItems.map((it) => it.currency)).size > 1;
  // Scadenze diverse → prepagamento di righe non ancora scadute (avviso).
  const mixedScadenza =
    new Set(selectedItems.map((it) => it.endDate)).size > 1;

  const canPay = selectedItems.length > 0 && !mixedCurrency;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canPay) {
      setError("Seleziona almeno un servizio da pagare");
      return;
    }
    setManualPending(true);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/pay-manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriptionItemIds: selectedIds,
            // L'importo è ricalcolato lato server dai prezzi delle righe; lo
            // inviamo comunque (lo schema lo richiede) coerente con il totale.
            amountCents: totalCents,
            note: note || undefined,
            paidAt: paidAt || undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Registrazione non riuscita");
        setManualPending(false);
        return;
      }
      setShowManual(false);
      setManualPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setManualPending(false);
    }
  }

  async function checkout(mode: "direct" | "send") {
    setError(null);
    setNotice(null);
    if (!canPay) {
      setError("Seleziona almeno un servizio da pagare");
      return;
    }
    const setPending = mode === "direct" ? setStripePending : setSendPending;
    setPending(true);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/checkout?mode=${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionItemIds: selectedIds }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Operazione non riuscita");
        setPending(false);
        return;
      }
      if (mode === "direct") {
        if (!body.url) {
          setError("Avvio pagamento non riuscito");
          setPending(false);
          return;
        }
        window.location.href = body.url;
        return;
      }
      if (body.sent) {
        setNotice(`Link di pagamento inviato a ${body.recipient}.`);
      } else {
        setError(
          "Link creato ma invio email non riuscito. Verifica la configurazione Resend.",
        );
      }
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nessun servizio pagabile: aggiungi una riga o riattiva un servizio
        cessato.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Selezione righe da pagare */}
      <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-4">
        <p className="mono-label mb-1">Servizi da pagare</p>
        {items.map((it) => (
          <label
            key={it.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!selected[it.id]}
                onChange={() => toggle(it.id)}
              />
              {it.serviceName}
              {it.quantity > 1 ? (
                <span className="text-xs text-slate-500">×{it.quantity}</span>
              ) : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                scad. {formatDate(it.endDate)}
              </span>
              <span className="font-mono text-xs text-slate-600">
                {formatEur(it.priceCents * it.quantity, it.currency)}
              </span>
            </span>
          </label>
        ))}
        <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2 text-sm font-medium">
          <span>Totale servizi</span>
          <span className="font-mono">{formatEur(totalCents, currency)}</span>
        </div>
        {serviceFeeCents > 0 ? (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>+ Costi di servizio (1,5%, solo carta)</span>
              <span className="font-mono">
                {formatEur(serviceFeeCents, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Totale con carta (Stripe)</span>
              <span className="font-mono">
                {formatEur(stripeTotalCents, currency)}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {mixedCurrency ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          I servizi selezionati hanno valute diverse: non è possibile
          raggrupparli in un unico pagamento. Seleziona righe con la stessa
          valuta.
        </p>
      ) : mixedScadenza ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          I servizi selezionati hanno scadenze diverse: verranno pagati insieme e
          ciascuno sarà rinnovato a partire dalla propria scadenza (i servizi non
          ancora scaduti risulteranno prepagati). Puoi procedere comunque.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!canPay}
          onClick={() => {
            setShowManual((v) => !v);
            setError(null);
            setNotice(null);
          }}
        >
          Registra pagamento manuale
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!canPay || sendPending}
          onClick={() => checkout("send")}
        >
          {sendPending ? "Invio…" : "Invia link di pagamento al cliente"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!canPay || stripePending}
          onClick={() => checkout("direct")}
        >
          {stripePending ? "Apertura…" : "Apri checkout ora"}
        </button>
      </div>

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showManual ? (
        <form
          onSubmit={submitManual}
          className="space-y-4 rounded-lg border border-line bg-canvas p-4"
        >
          <p className="text-sm text-ink">
            Importo totale:{" "}
            <span className="font-mono font-medium">
              {formatEur(totalCents, currency)}
            </span>{" "}
            <span className="text-xs text-slate-500">
              (somma dei servizi selezionati)
            </span>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="paidAt" className="field-label">
                Data pagamento
              </label>
              <input
                id="paidAt"
                type="date"
                className="field"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="manualNote" className="field-label">
                Note
              </label>
              <input
                id="manualNote"
                className="field"
                placeholder="es. bonifico ricevuto il 12/06"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary"
              disabled={manualPending}
            >
              {manualPending ? "Registrazione…" : "Conferma pagamento"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowManual(false)}
            >
              Annulla
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
