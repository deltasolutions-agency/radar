"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatEur } from "@/lib/format";
import { MANUAL_PAYMENT_METHODS } from "@/lib/validations";

/**
 * Pannello dell'abbonamento IN ATTESA DEL PRIMO PAGAMENTO: stato del link,
 * "Segna come pagato" (pagamento manuale di attivazione), "Reinvia link primo
 * pagamento" e "Annulla abbonamento in attesa" (conferma semplice).
 */
export function FirstPaymentPanel({
  subscriptionId,
  netCents,
  grossCents,
  currency,
  linkSentLabel,
  linkInvalidated,
  hasClientEmail,
}: {
  subscriptionId: string;
  /** Imponibile del primo pagamento (prezzi iniziali). */
  netCents: number;
  /** Totale IVA inclusa (senza commissione, che vale solo per la carta). */
  grossCents: number;
  currency: string;
  /** "inviato il …" oppure null se nessun link valido è stato inviato. */
  linkSentLabel: string | null;
  /** Il link era stato inviato ma è stato invalidato (righe modificate, storno). */
  linkInvalidated: boolean;
  hasClientEmail: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "manual" | "cancel">("idle");
  const [method, setMethod] = useState<string>(MANUAL_PAYMENT_METHODS[0]);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(action: string, url: string, body?: unknown, success?: string) {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Operazione non riuscita");
        setPending(null);
        return;
      }
      setPending(null);
      setMode("idle");
      if (success) setNotice(success);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="mono-label w-28 shrink-0">Imponibile</dt>
          <dd className="font-mono text-ink">{formatEur(netCents, currency)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="mono-label w-28 shrink-0">IVA inclusa</dt>
          <dd className="font-mono text-ink">
            {formatEur(grossCents, currency)}{" "}
            <span className="font-sans text-xs text-slate-500">(+ commissione se con carta)</span>
          </dd>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <dt className="mono-label w-28 shrink-0">Link</dt>
          <dd className="text-ink">{linkSentLabel ?? "non inviato"}</dd>
        </div>
      </dl>

      {linkInvalidated ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Il link inviato non è più valido (servizi o importi modificati, oppure
          primo pagamento stornato). <strong>Reinvia link primo pagamento</strong>{" "}
          con il nuovo importo: {formatEur(netCents, currency)} + IVA.
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!!pending}
          onClick={() => setMode(mode === "manual" ? "idle" : "manual")}
        >
          Segna come pagato
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!!pending || !hasClientEmail}
          title={hasClientEmail ? undefined : "Il cliente non ha un indirizzo email"}
          onClick={() =>
            call(
              "resend",
              `/api/subscriptions/${subscriptionId}/first-payment-link`,
              {},
              "Link del primo pagamento inviato al cliente.",
            )
          }
        >
          {pending === "resend" ? "Invio…" : "Reinvia link primo pagamento"}
        </button>
        <button
          type="button"
          className="btn-ghost text-red-700"
          disabled={!!pending}
          onClick={() => setMode(mode === "cancel" ? "idle" : "cancel")}
        >
          Annulla abbonamento in attesa
        </button>
      </div>

      {mode === "manual" ? (
        <form
          className="space-y-4 rounded-lg border border-line bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault();
            call(
              "manual",
              `/api/subscriptions/${subscriptionId}/activate-manual`,
              { method, paidAt: paidAt || undefined, note: note || undefined },
              "Primo pagamento registrato: abbonamento attivo.",
            );
          }}
        >
          <p className="text-sm text-ink">
            Importo:{" "}
            <span className="font-mono font-medium">{formatEur(grossCents, currency)}</span>{" "}
            <span className="text-xs text-slate-500">
              (prezzi iniziali, IVA 22% inclusa). Le date restano quelle impostate.
            </span>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="fpMethod" className="field-label">
                Metodo
              </label>
              <select
                id="fpMethod"
                className="field"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {MANUAL_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fpPaidAt" className="field-label">
                Data pagamento
              </label>
              <input
                id="fpPaidAt"
                type="date"
                className="field"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="fpNote" className="field-label">
                Note
              </label>
              <input
                id="fpNote"
                className="field"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={!!pending}>
              {pending === "manual" ? "Registrazione…" : "Conferma pagamento"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMode("idle")}>
              Annulla
            </button>
          </div>
        </form>
      ) : null}

      {mode === "cancel" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            Annullare l&apos;abbonamento in attesa? Il link di pagamento non sarà
            più valido e l&apos;abbonamento non comparirà più in cron, scadenze e
            conteggi. Nessun dato viene cancellato.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!!pending}
              onClick={() =>
                call("cancel", `/api/subscriptions/${subscriptionId}/cancel-pending`)
              }
            >
              {pending === "cancel" ? "Attendere…" : "Sì, annulla abbonamento"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMode("idle")}>
              No
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "Annulla pagamento di attivazione" (primo pagamento manuale), con conferma. */
export function CancelActivationButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/cancel-activation`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Operazione non riuscita");
        setPending(false);
        return;
      }
      setPending(false);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-violet-700 hover:underline"
        onClick={() => setConfirming(true)}
      >
        Annulla pagamento di attivazione
      </button>
    );
  }
  return (
    <div className="max-w-[16rem] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs text-amber-800">
        Il pagamento risulterà stornato e l&apos;abbonamento tornerà in attesa del
        primo pagamento. Le date non cambiano.
      </p>
      {error ? <p className="mt-1 text-xs font-medium text-red-700">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary text-xs" disabled={pending} onClick={run}>
          {pending ? "Attendere…" : "Sì, annulla"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          No
        </button>
      </div>
    </div>
  );
}
