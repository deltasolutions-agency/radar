"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SelectableAutoChargeItem = {
  id: string;
  serviceName: string;
  priceLabel: string;
  periodicityLabel: string;
};

/**
 * Sezione a livello di CONTENITORE per richiedere l'attivazione del rinnovo
 * automatico su un SOTTOINSIEME ESPLICITO di servizi scelto dall'admin.
 * L'admin seleziona i servizi (checkbox) e invia una richiesta: il cliente
 * autorizzerà esattamente quei servizi (mai "tutti automaticamente").
 */
export function AutoChargeRequestPanel({
  subscriptionId,
  items,
}: {
  subscriptionId: string;
  items: SelectableAutoChargeItem[];
}) {
  const router = useRouter();
  // Default: nessuna selezione (l'admin sceglie esplicitamente).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);

  const selectedIds = items.filter((it) => selected[it.id]).map((it) => it.id);
  const canSend = selectedIds.length > 0 && !pending;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function sendRequest() {
    if (selectedIds.length === 0) return;
    setPending(true);
    setError(null);
    setNotice(null);
    setActivationUrl(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/auto-charge-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionItemIds: selectedIds }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Invio richiesta non riuscito");
        setPending(false);
        return;
      }
      setActivationUrl(body.url ?? null);
      setNotice(
        body.sent
          ? `Richiesta inviata a ${body.recipient}.`
          : "Richiesta creata, ma invio email non riuscito. Puoi comunque dettare il link qui sotto.",
      );
      setSelected({});
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
        Nessun servizio idoneo: tutti i servizi sono già in rinnovo automatico,
        cessati o sospesi.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Seleziona i servizi da includere nella richiesta. Il cliente registrerà
        la carta e autorizzerà <strong>esattamente i servizi selezionati</strong>.
      </p>

      <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-4">
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
            </span>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              <span>{it.periodicityLabel}</span>
              <span className="font-mono text-slate-600">{it.priceLabel}</span>
            </span>
          </label>
        ))}
      </div>

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {activationUrl ? (
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <p className="mono-label mb-1">Link da dettare al cliente</p>
          <p className="break-all font-mono text-xs text-ink">{activationUrl}</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        disabled={!canSend}
        onClick={sendRequest}
      >
        {pending
          ? "Invio…"
          : `Invia richiesta di attivazione${
              selectedIds.length > 0 ? ` (${selectedIds.length})` : ""
            }`}
      </button>
    </div>
  );
}
