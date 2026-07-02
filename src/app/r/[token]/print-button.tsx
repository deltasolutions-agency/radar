"use client";

/** Pulsante di stampa, nascosto nell'output cartaceo (@media print). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary print:hidden"
    >
      Stampa
    </button>
  );
}
