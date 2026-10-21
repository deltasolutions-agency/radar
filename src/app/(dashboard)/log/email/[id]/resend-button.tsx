"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Reinvia l'email (nuovo log MANUAL, senza dedupeKey) dopo conferma esplicita. */
export function ResendButton({ id, recipient }: { id: string; recipient: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/email-logs/${id}/resend`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.logId) {
        router.push(`/log/email/${body.logId}`);
        router.refresh();
        return;
      }
      setMessage({ ok: false, text: body.error ?? "Reinvio non riuscito" });
      if (body.details?.logId) router.refresh();
    } catch {
      setMessage({ ok: false, text: "Errore di rete" });
    }
    setPending(false);
    setConfirming(false);
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Reinviare questa email a <strong>{recipient || "—"}</strong>?
          </span>
          <button type="button" className="btn-primary" disabled={pending} onClick={resend}>
            {pending ? "Invio…" : "Conferma reinvio"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Annulla
          </button>
        </div>
      ) : (
        <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
          Reinvia
        </button>
      )}
      {message ? (
        <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
