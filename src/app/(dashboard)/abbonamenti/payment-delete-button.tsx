"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Elimina il LOG di un pagamento (cancellazione secca del record) tramite un
 * MODALE con conferma testuale esatta. DIVERSO dallo storno: NON tocca lo stato
 * né la scadenza del servizio collegato — rimuove solo il record di pagamento,
 * la ricevuta e le notifiche collegate.
 */
export function PaymentDeleteButton({
  paymentId,
  expectedText,
}: {
  paymentId: string;
  expectedText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = value.trim() === expectedText;

  function close() {
    if (pending) return;
    setOpen(false);
    setValue("");
    setError(null);
  }

  async function handleDelete() {
    if (!matches) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/force-delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: value.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Eliminazione non riuscita");
        setPending(false);
        return;
      }
      setOpen(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="text-xs text-red-600 hover:underline"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        Elimina
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`del-${paymentId}-title`}
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id={`del-${paymentId}-title`}
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Elimina log pagamento
            </h2>

            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
                <strong>Attenzione:</strong> questa azione elimina solo il log del
                pagamento (record, ricevuta e notifiche collegate).{" "}
                <strong>
                  NON modifica lo stato o la scadenza del servizio.
                </strong>{" "}
                Non è uno storno e non è reversibile.
              </p>
              <p>
                Per confermare digita esattamente questo testo:
                <br />
                <span className="mt-1 inline-block break-all rounded bg-canvas px-2 py-1 font-mono text-xs text-ink">
                  {expectedText}
                </span>
              </p>
            </div>

            <input
              type="text"
              className="field mt-3"
              autoFocus
              value={value}
              placeholder="Testo di conferma"
              onChange={(e) => setValue(e.target.value)}
            />
            {error ? (
              <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-ghost w-full sm:w-auto"
                disabled={pending}
                onClick={close}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-danger w-full sm:w-auto disabled:opacity-50"
                disabled={!matches || pending}
                onClick={handleDelete}
              >
                {pending ? "Eliminazione…" : "Elimina definitivamente"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
