"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EditableField = {
  key: string;
  label: string;
  value: string;
  /** input type (es. "email" per la PEC). */
  type?: string;
};

/**
 * Vista dei dati di fatturazione per il cliente (pagina pubblica).
 *
 * - Mostra SEMPRE i dati correnti in sola lettura.
 * - Se `unlocked` è true: bottone "Modifica" → campi editabili → "Salva".
 * - Se `unlocked` è false: nessun bottone, messaggio informativo neutro.
 *
 * La modifica è consumabile: dopo un salvataggio riuscito il backend imposta
 * dataEditUnlocked=false e la pagina, al refresh, mostrerà lo stato bloccato.
 */
export function DataEditForm({
  clientId,
  token,
  unlocked,
  fields,
}: {
  clientId: string;
  token: string;
  unlocked: boolean;
  fields: EditableField[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (k: string) => (v: string) =>
    setValues((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/self-update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...values }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && body.details) {
          setErrors(body.details);
        } else {
          setFormError(body.error ?? "Salvataggio non riuscito");
        }
        setPending(false);
        return;
      }
      setDone(body.message ?? "Dati aggiornati");
      setEditing(false);
      setPending(false);
      router.refresh();
    } catch {
      setFormError("Errore di rete durante il salvataggio");
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">{done}</p>
        <p className="mt-1 text-xs text-emerald-700">
          Grazie. Abbiamo ricevuto i tuoi dati aggiornati.
        </p>
      </div>
    );
  }

  // ── Modalità sola lettura ────────────────────────────────────────────────
  if (!editing) {
    return (
      <div>
        <dl className="divide-y divide-line-soft">
          {fields.map((f) => (
            <div
              key={f.key}
              className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="mono-label w-40 shrink-0">{f.label}</dt>
              <dd className="text-sm text-ink">
                {f.value.trim() ? f.value : "—"}
              </dd>
            </div>
          ))}
        </dl>

        {unlocked ? (
          <button
            type="button"
            className="btn-primary mt-5"
            onClick={() => setEditing(true)}
          >
            Modifica
          </button>
        ) : (
          <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Hai già aggiornato i tuoi dati di recente. Per un&apos;ulteriore
            modifica, scrivi a{" "}
            <a
              href="mailto:hello@deltasolutions.agency"
              className="text-brand underline"
            >
              hello@deltasolutions.agency
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  // ── Modalità modifica ─────────────────────────────────────────────────────
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key} className="field-label">
              {f.label}
            </label>
            <input
              id={f.key}
              name={f.key}
              type={f.type ?? "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key)(e.target.value)}
              className="field"
            />
            {errors[f.key] ? (
              <p className="mt-1 text-xs text-red-600">{errors[f.key]}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva modifiche"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() => {
            setEditing(false);
            setErrors({});
            setFormError(null);
            setValues(
              Object.fromEntries(fields.map((f) => [f.key, f.value])),
            );
          }}
        >
          Annulla
        </button>
      </div>
    </form>
  );
}
