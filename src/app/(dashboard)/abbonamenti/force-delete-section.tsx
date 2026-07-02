"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Zona pericolosa: eliminazione permanente dell'abbonamento e di TUTTI i dati
 * collegati (pagamenti, ricevute, notifiche). Il pulsante si abilita solo dopo
 * aver digitato ESATTAMENTE la stringa attesa "{clientName} / {serviceName}".
 */
export function ForceDeleteSection({
  subscriptionId,
  expectedText,
}: {
  subscriptionId: string;
  expectedText: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = text === expectedText;

  async function handleDelete() {
    if (!matches) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/force-delete`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmText: text }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Eliminazione non riuscita");
        setPending(false);
        return;
      }
      router.push("/abbonamenti");
      router.refresh();
    } catch {
      setError("Errore di rete durante l'eliminazione");
      setPending(false);
    }
  }

  return (
    <section className="rounded-card border border-red-300 bg-red-50 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">
        Zona pericolosa
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-red-800">
        Questa azione elimina{" "}
        <strong>PERMANENTEMENTE</strong> l&apos;abbonamento e tutti i pagamenti,
        ricevute e notifiche collegate. Non è recuperabile. Usa questa funzione
        solo per dati di test.
      </p>

      <label
        htmlFor="forceDeleteConfirm"
        className="mt-4 block text-sm text-red-800"
      >
        Per confermare, scrivi esattamente:{" "}
        <span className="font-mono font-medium">{expectedText}</span>
      </label>
      <input
        id="forceDeleteConfirm"
        type="text"
        autoComplete="off"
        className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {error ? (
        <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      <button
        type="button"
        className="btn-danger mt-4"
        disabled={!matches || pending}
        onClick={handleDelete}
      >
        {pending ? "Eliminazione…" : "Elimina definitivamente"}
      </button>
    </section>
  );
}
