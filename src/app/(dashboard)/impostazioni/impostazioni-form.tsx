"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TemplateField = {
  type: string;
  label: string;
  defaultSubject: string;
  defaultBody: string;
  subject: string;
  body: string;
};

export type ImpostazioniInitial = {
  thresholdsLongDays: string;
  thresholdsShortDays: string;
  overdueDays: string;
  cessationDay: string;
  templates: TemplateField[];
};

/** "30, 15, 7" → [30,15,7]; scarta i non-numerici. */
function parseIntList(input: string): number[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

export function ImpostazioniForm({ initial }: { initial: ImpostazioniInitial }) {
  const router = useRouter();
  const [longDays, setLongDays] = useState(initial.thresholdsLongDays);
  const [shortDays, setShortDays] = useState(initial.thresholdsShortDays);
  const [overdue, setOverdue] = useState(initial.overdueDays);
  const [cessation, setCessation] = useState(initial.cessationDay);
  const [templates, setTemplates] = useState(initial.templates);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function patchTemplate(type: string, patch: Partial<TemplateField>) {
    setTemplates((ts) =>
      ts.map((t) => (t.type === type ? { ...t, ...patch } : t)),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const payload = {
      thresholdsLongDays: parseIntList(longDays),
      thresholdsShortDays: parseIntList(shortDays),
      overdueDays: parseIntList(overdue),
      cessationDay: parseInt(cessation, 10) || 0,
      templates: Object.fromEntries(
        templates.map((t) => [
          t.type,
          { subject: t.subject || null, body: t.body || null },
        ]),
      ),
    };

    try {
      const res = await fetch("/api/settings/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Salvataggio non riuscito");
        setPending(false);
        return;
      }
      setNotice("Impostazioni salvate.");
      setPending(false);
      router.refresh();
    } catch {
      setError("Errore di rete durante il salvataggio");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {/* Soglie temporali */}
      <section className="card space-y-4 p-6">
        <div>
          <h2 className="mono-label">Soglie temporali (giorni)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Elenchi separati da virgola. I promemoria pre-scadenza usano al
            massimo 3 valori (dal più lontano al più vicino).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="longDays" className="field-label">
              Pre-scadenza · periodi lunghi (annuali)
            </label>
            <input
              id="longDays"
              className="field"
              value={longDays}
              onChange={(e) => setLongDays(e.target.value)}
              placeholder="30, 15, 7"
            />
          </div>
          <div>
            <label htmlFor="shortDays" className="field-label">
              Pre-scadenza · periodi corti (mensili)
            </label>
            <input
              id="shortDays"
              className="field"
              value={shortDays}
              onChange={(e) => setShortDays(e.target.value)}
              placeholder="10, 5, 1"
            />
          </div>
          <div>
            <label htmlFor="overdue" className="field-label">
              Solleciti · giorni dopo la scadenza
            </label>
            <input
              id="overdue"
              className="field"
              value={overdue}
              onChange={(e) => setOverdue(e.target.value)}
              placeholder="0, 1, 2, 7, 10"
            />
          </div>
          <div>
            <label htmlFor="cessation" className="field-label">
              Cessazione per morosità · giorni dopo la scadenza
            </label>
            <input
              id="cessation"
              type="number"
              min={0}
              className="field"
              value={cessation}
              onChange={(e) => setCessation(e.target.value)}
              placeholder="11"
            />
          </div>
        </div>
      </section>

      {/* Testi email */}
      <section className="card space-y-5 p-6">
        <div>
          <h2 className="mono-label">Testi email</h2>
          <p className="mt-1 text-xs text-slate-500">
            Lascia vuoto per usare il testo predefinito (mostrato come
            segnaposto). Segnaposto disponibili:{" "}
            <code className="font-mono text-[11px]">
              {"{clientName} {serviceName} {endDate} {diffDays} {diffDaysAfter}"}
            </code>
          </p>
        </div>

        <div className="space-y-6">
          {templates.map((t) => (
            <div
              key={t.type}
              className="space-y-3 border-t border-line-soft pt-5 first:border-0 first:pt-0"
            >
              <h3 className="text-sm font-medium text-ink">{t.label}</h3>
              <div>
                <label
                  htmlFor={`subj-${t.type}`}
                  className="field-label"
                >
                  Oggetto
                </label>
                <input
                  id={`subj-${t.type}`}
                  className="field"
                  value={t.subject}
                  placeholder={t.defaultSubject}
                  onChange={(e) =>
                    patchTemplate(t.type, { subject: e.target.value })
                  }
                />
              </div>
              <div>
                <label htmlFor={`body-${t.type}`} className="field-label">
                  Corpo
                </label>
                <textarea
                  id={`body-${t.type}`}
                  rows={3}
                  className="field"
                  value={t.body}
                  placeholder={t.defaultBody}
                  onChange={(e) =>
                    patchTemplate(t.type, { body: e.target.value })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          className="btn-primary w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? "Salvataggio…" : "Salva impostazioni"}
        </button>
      </div>
    </form>
  );
}
