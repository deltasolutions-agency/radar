"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Invia all'admin un reminder di esempio (dati fittizi) e aggiorna l'elenco. */
export function TestEmailButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/email-logs/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(
        res.ok
          ? { ok: true, text: `Email di test inviata a ${body.recipient}` }
          : { ok: false, text: body.error ?? "Invio non riuscito" },
      );
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Errore di rete" });
    }
    setPending(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-ghost" disabled={pending} onClick={send}>
        {pending ? "Invio…" : "Invia email di test"}
      </button>
      {message ? (
        <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
