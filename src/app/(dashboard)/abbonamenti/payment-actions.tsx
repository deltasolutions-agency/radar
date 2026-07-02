"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { manualPaymentSchema } from "@/lib/validations";

/** "12,50" / "12.50" → 1250 centesimi; "" → NaN. */
function euroToCents(input: string): number {
  const n = parseFloat(input.replace(",", ".").trim());
  return Math.round(n * 100);
}

/**
 * Azioni di pagamento sul dettaglio abbonamento:
 * - "Registra pagamento manuale": form inline → POST /pay-manual
 * - "Avvia pagamento Stripe": crea la sessione di checkout → redirect (solo
 *   se il metodo dell'abbonamento è STRIPE)
 */
export function PaymentActions({
  subscriptionId,
  paymentMethod,
  defaultAmountEuro,
}: {
  subscriptionId: string;
  paymentMethod: string;
  defaultAmountEuro: string;
}) {
  const router = useRouter();

  const [showManual, setShowManual] = useState(false);
  const [amountEuro, setAmountEuro] = useState(defaultAmountEuro);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [manualPending, setManualPending] = useState(false);

  const [stripePending, setStripePending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Apre/chiude il form manuale. All'apertura ripristina l'importo al prezzo
  // corrente (che può essere cambiato dopo un rinnovo) mantenendolo editabile.
  function toggleManual() {
    setShowManual((v) => {
      const next = !v;
      if (next) {
        setAmountEuro(defaultAmountEuro);
        setPaidAt("");
        setNote("");
        setErrors({});
        setError(null);
      }
      return next;
    });
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);

    const amountCents = euroToCents(amountEuro);
    const payload = {
      amountCents: Number.isNaN(amountCents) ? undefined : amountCents,
      note,
      paidAt: paidAt || undefined,
    };
    const parsed = manualPaymentSchema.safeParse(payload);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (key === "amountCents") fe.amountEuro = issue.message;
        else if (!fe[key]) fe[key] = issue.message;
      }
      setErrors(fe);
      return;
    }

    setManualPending(true);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/pay-manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
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

  // "Apri checkout ora": redirect immediato dell'admin al checkout Stripe.
  async function openCheckout() {
    setStripePending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/checkout?mode=direct`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setError(body.error ?? "Avvio pagamento non riuscito");
        setStripePending(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Errore di rete");
      setStripePending(false);
    }
  }

  // "Invia link al cliente": crea la sessione e la invia via email.
  async function sendLink() {
    setSendPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/checkout?mode=send`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Invio link non riuscito");
        setSendPending(false);
        return;
      }
      if (body.sent) {
        setNotice(`Link di pagamento inviato a ${body.recipient}.`);
      } else {
        setError(
          "Link creato ma invio email non riuscito. Verifica la configurazione Resend.",
        );
      }
      setSendPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setSendPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={toggleManual}>
          Registra pagamento manuale
        </button>
        {paymentMethod === "STRIPE" ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              disabled={sendPending}
              onClick={sendLink}
            >
              {sendPending ? "Invio…" : "Invia link di pagamento al cliente"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={stripePending}
              onClick={openCheckout}
            >
              {stripePending ? "Apertura…" : "Apri checkout ora"}
            </button>
          </>
        ) : null}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="amountEuro" className="field-label">
                Importo (€) <span className="text-red-600">*</span>
              </label>
              <input
                id="amountEuro"
                inputMode="decimal"
                className="field"
                value={amountEuro}
                onChange={(e) => setAmountEuro(e.target.value)}
              />
              {errors.amountEuro ? (
                <p className="mt-1 text-xs text-red-600">{errors.amountEuro}</p>
              ) : null}
            </div>
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
              {errors.paidAt ? (
                <p className="mt-1 text-xs text-red-600">{errors.paidAt}</p>
              ) : null}
            </div>
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
