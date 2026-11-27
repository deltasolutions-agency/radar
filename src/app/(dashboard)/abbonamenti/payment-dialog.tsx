"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PaymentActions, type PayableItem } from "./payment-actions";

/**
 * Pulsante "Pagamento" in testata: apre un popup con le azioni di pagamento
 * (registra pagamento manuale, invia link al cliente, apri checkout).
 */
export function PaymentDialogButton({
  subscriptionId,
  items,
  serviceFeeEnabled,
}: {
  subscriptionId: string;
  items: PayableItem[];
  serviceFeeEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Pagamento
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10"
              role="dialog"
              aria-modal="true"
              aria-label="Pagamento"
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <div className="card w-full max-w-3xl p-6 text-left">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Pagamento</h2>
                    <p className="text-sm text-slate-500">
                      Scegli i servizi, poi registra un pagamento manuale, invia il link al cliente o apri il checkout.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-canvas"
                    aria-label="Chiudi"
                    onClick={() => setOpen(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <PaymentActions subscriptionId={subscriptionId} items={items} serviceFeeEnabled={serviceFeeEnabled} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
