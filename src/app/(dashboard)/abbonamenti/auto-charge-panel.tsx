"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pannello rinnovo automatico sul dettaglio abbonamento:
 * - se la carta non è ancora registrata → invia al cliente la richiesta di
 *   attivazione (email con link self-service + gate consenso);
 * - se la carta c'è ma l'addebito è disattivo → form di attivazione (+ data fine);
 * - se attivo → stato con periodicità ed eventuale scadenza + disattivazione.
 */
export function AutoChargePanel({
  subscriptionId,
  hasCard,
  autoChargeEnabled,
  autoChargeEndDateInput,
  autoChargeEndDateLabel,
  periodicityLabel,
}: {
  subscriptionId: string;
  hasCard: boolean;
  autoChargeEnabled: boolean;
  autoChargeEndDateInput: string;
  autoChargeEndDateLabel: string | null;
  periodicityLabel: string;
}) {
  const router = useRouter();
  const [endDate, setEndDate] = useState(autoChargeEndDateInput);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  async function sendRequest() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/setup-auto-charge`,
        { method: "POST" },
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
      setPending(false);
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  async function patch(data: Record<string, unknown>, okThen?: () => void) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Operazione non riuscita");
        setPending(false);
        return;
      }
      okThen?.();
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  // ── Attivo ────────────────────────────────────────────────────────────────
  if (autoChargeEnabled) {
    return (
      <div className="space-y-2">
        <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          Rinnovo automatico attivo
        </span>
        <p className="text-sm text-ink">
          Addebito automatico {periodicityLabel.toLowerCase()} ·{" "}
          {autoChargeEndDateLabel
            ? `fino al ${autoChargeEndDateLabel}`
            : "nessuna scadenza"}
        </p>
        <p className="text-xs text-slate-500">
          La periodicità dipende dall&apos;abbonamento: si modifica dal pulsante
          &quot;Modifica&quot;.
        </p>
        {!confirmingDisable ? (
          <>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setError(null);
                setConfirmingDisable(true);
              }}
            >
              Disattiva rinnovo automatico
            </button>
          </>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              Confermi la disattivazione del rinnovo automatico? La carta resta
              salvata e potrai riattivarlo senza registrarla di nuovo.
            </p>
            {error ? (
              <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={pending}
                onClick={() =>
                  patch({ autoChargeEnabled: false }, () =>
                    setConfirmingDisable(false),
                  )
                }
              >
                {pending ? "Disattivazione…" : "Sì, disattiva"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={pending}
                onClick={() => {
                  setConfirmingDisable(false);
                  setError(null);
                }}
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Carta non registrata → invia richiesta al cliente ─────────────────────
  if (!hasCard) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Invia al cliente la richiesta di attivazione: registrerà la carta dopo
          aver accettato Privacy e Termini.
        </p>
        {notice ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {activationUrl ? (
          <div className="rounded-lg border border-line bg-canvas px-3 py-2">
            <p className="mono-label mb-1">Link da dettare al cliente</p>
            <p className="break-all font-mono text-xs text-ink">
              {activationUrl}
            </p>
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={sendRequest}
        >
          {pending ? "Invio…" : "Invia richiesta di attivazione al cliente"}
        </button>
      </div>
    );
  }

  // ── Carta registrata, addebito disattivo → form di attivazione ────────────
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Carta registrata. Puoi attivare l&apos;addebito automatico{" "}
        {periodicityLabel.toLowerCase()} (cadenza dell&apos;abbonamento).
      </p>
      <div>
        <label htmlFor="autoChargeEndDate" className="field-label">
          Data di fine addebito automatico (opzionale)
        </label>
        <input
          id="autoChargeEndDate"
          type="date"
          className="field"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          patch({
            autoChargeEnabled: true,
            autoChargeEndDate: endDate || null,
          })
        }
      >
        {pending ? "Attivazione…" : "Attiva addebito automatico"}
      </button>
    </div>
  );
}
