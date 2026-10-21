"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "a@x.it, b@y.it; c@z.it" → ["a@x.it", "b@y.it", "c@z.it"] */
function parseRecipients(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Reinvio di un'email registrata (solo admin): mostra i destinatari originali e
 * quelli attuali dell'anagrafica, permette di modificarli e reinvia lo SNAPSHOT
 * salvato (stesso oggetto e contenuto, nessun ricalcolo).
 */
export function ResendDialog({
  id,
  originalTo,
  currentAddresses,
  addressChanged,
  suggestions,
  defaultRecipients,
  sentAtLabel,
  isOld,
}: {
  id: string;
  originalTo: string[];
  /** Indirizzi attuali in anagrafica (vuoto se non pertinente). */
  currentAddresses: string[];
  addressChanged: boolean;
  /** Indirizzi aggiuntivi proponibili (es. PEC), non precompilati. */
  suggestions: string[];
  defaultRecipients: string[];
  sentAtLabel: string;
  isOld: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultRecipients.join(", "));
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const recipients = parseRecipients(value);
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r));

  async function send() {
    setErr(null);
    if (recipients.length === 0) return setErr("Indica almeno un destinatario.");
    if (invalid.length > 0) return setErr(`Indirizzi non validi: ${invalid.join(", ")}`);
    setPending(true);
    try {
      const res = await fetch(`/api/email-logs/${id}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.logId) {
        router.push(`/log/email/${body.logId}`);
        router.refresh();
        return;
      }
      setErr(body.error ?? "Reinvio non riuscito");
      if (body.details?.logId) router.refresh();
    } catch {
      setErr("Errore di rete");
    }
    setPending(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Reinvia
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resend-title"
    >
      <div className="card w-full max-w-lg space-y-4 bg-white p-6">
        <h2 id="resend-title" className="text-lg font-semibold">
          Reinvia email
        </h2>

        {isOld ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Il contenuto è quello inviato il {sentAtLabel}: importi e date
            potrebbero non essere più attuali.
          </p>
        ) : null}

        <div className="text-sm">
          <p className="mono-label">Destinatari originali</p>
          <p className="mt-1 text-slate-700">{originalTo.join(", ") || "—"}</p>
        </div>

        {currentAddresses.length > 0 ? (
          <div className="text-sm">
            <p className="mono-label">Indirizzo attuale in anagrafica</p>
            <p className="mt-1 text-slate-700">
              {currentAddresses.join(", ")}
              {addressChanged ? (
                <span className="ml-2 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Indirizzo cambiato in anagrafica
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor="resend-recipients" className="field-label">
            Destinatari del reinvio
          </label>
          <input
            id="resend-recipients"
            className="field"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="email@esempio.it, altro@esempio.it"
          />
          <p className="mt-1 text-xs text-slate-500">
            Uno o più indirizzi separati da virgola. L&apos;anagrafica del cliente
            non viene modificata.
          </p>
          {suggestions.filter((s) => !recipients.includes(s)).length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {suggestions
                .filter((s) => !recipients.includes(s))
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-md border border-line px-2 py-0.5 text-slate-600 hover:bg-canvas"
                    onClick={() => setValue([...recipients, s].join(", "))}
                  >
                    + {s} (PEC)
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        <p className="text-xs text-slate-500">
          Verrà reinviato lo stesso oggetto e lo stesso contenuto salvati (nessun
          ricalcolo). Eventuali allegati non vengono reinviati.
        </p>

        {err ? <p className="text-sm text-red-700">{err}</p> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setErr(null);
            }}
          >
            Annulla
          </button>
          <button type="button" className="btn-primary" disabled={pending} onClick={send}>
            {pending ? "Invio…" : "Conferma reinvio"}
          </button>
        </div>
      </div>
    </div>
  );
}
