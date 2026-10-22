"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

const TEXT = {
  invoice: {
    on: "Sì",
    off: "No",
    dialogOn: "Segna come fatturato",
    dialogOff: 'Togliere "fatturato"?',
    offHint: "Numero e data della fattura verranno cancellati.",
    numberLabel: "Numero fattura (facoltativo)",
    dateLabel: "Data fattura",
  },
  creditNote: {
    on: "Emessa",
    off: "Da emettere",
    dialogOn: "Nota di credito emessa",
    dialogOff: 'Togliere "nota di credito emessa"?',
    offHint: "Numero e data della nota di credito verranno cancellati.",
    numberLabel: "Numero nota di credito (facoltativo)",
    dateLabel: "Data nota di credito",
  },
} as const;

/**
 * Interruttore Sì/No in tabella per "fatturato" o "nota di credito emessa".
 * Accendere apre un popup con numero e data facoltativi (data di default:
 * oggi); spegnere chiede conferma. Salva subito (PATCH /invoicing).
 */
export function InvoicingToggle({
  paymentId,
  target,
  issued,
  number,
  date,
  today,
}: {
  paymentId: string;
  target: "invoice" | "creditNote";
  issued: boolean;
  number: string | null;
  /** YYYY-MM-DD o null. */
  date: string | null;
  /** Oggi in Europe/Rome (YYYY-MM-DD), default della data. */
  today: string;
}) {
  const router = useRouter();
  const t = TEXT[target];
  const [dialog, setDialog] = useState<"on" | "off" | null>(null);
  const [numberValue, setNumberValue] = useState("");
  const [dateValue, setDateValue] = useState(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: boolean) {
    setError(null);
    if (next) {
      setNumberValue("");
      setDateValue(today);
    }
    setDialog(next ? "on" : "off");
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/invoicing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          dialog === "on"
            ? {
                target,
                issued: true,
                number: numberValue,
                date: dateValue || null,
              }
            : { target, issued: false },
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Salvataggio non riuscito");
        setPending(false);
        return;
      }
      setPending(false);
      setDialog(null);
      router.refresh();
    } catch {
      setError("Errore di rete");
      setPending(false);
    }
  }

  return (
    <div className="min-w-[7rem]">
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span className="relative inline-block h-5 w-9 shrink-0">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={issued}
            onChange={(e) => open(e.target.checked)}
            aria-label={
              target === "invoice" ? "Fatturato" : "Nota di credito emessa"
            }
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
        <span className="text-xs text-ink">{issued ? t.on : t.off}</span>
      </label>
      {issued && (number || date) ? (
        <p className="mt-1 text-xs text-slate-500">
          {number ? `n. ${number}` : null}
          {number && date ? " · " : null}
          {date ? date.split("-").reverse().join("/") : null}
        </p>
      ) : null}

      {/* Portal: le celle sticky della tabella creano un proprio livello. */}
      {dialog
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
              role="dialog"
              aria-modal="true"
              aria-label={dialog === "on" ? t.dialogOn : t.dialogOff}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !pending) setDialog(null);
              }}
            >
              <div className="card w-full max-w-sm p-5 text-left">
                <h3 className="text-base font-semibold">
                  {dialog === "on" ? t.dialogOn : t.dialogOff}
                </h3>
                {dialog === "on" ? (
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs text-slate-500">
                      {t.numberLabel}
                      <input
                        className="field mt-1"
                        value={numberValue}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => setNumberValue(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs text-slate-500">
                      {t.dateLabel}
                      <input
                        type="date"
                        className="field mt-1"
                        value={dateValue}
                        onChange={(e) => setDateValue(e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">{t.offHint}</p>
                )}
                {error ? (
                  <p className="mt-3 text-sm font-medium text-red-700">
                    {error}
                  </p>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={pending}
                    onClick={save}
                  >
                    {pending
                      ? "Salvataggio…"
                      : dialog === "on"
                        ? "Salva"
                        : "Sì, togli"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending}
                    onClick={() => setDialog(null)}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
