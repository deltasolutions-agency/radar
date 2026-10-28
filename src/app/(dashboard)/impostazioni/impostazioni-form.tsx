"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TemplateLang = "it" | "en";

const TEMPLATE_LANG_LABELS: Record<TemplateLang, string> = {
  it: "Italiano",
  en: "English",
};

export type TemplateField = {
  type: string;
  /** Lingua del testo: ogni lingua ha oggetto, corpo e default propri. */
  lang: TemplateLang;
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
  autoChargeReminderHours: string;
  autoChargeMaxDelayDays: string;
  firstPaymentReminderDays: string;
  firstPaymentAdminAlertDay: string;
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

export function ImpostazioniForm({
  initial,
  placeholders,
}: {
  initial: ImpostazioniInitial;
  /** Legenda dei segnaposto dei template reminder, per lingua. */
  placeholders: Record<TemplateLang, { token: string; description: string }[]>;
}) {
  const router = useRouter();
  const [longDays, setLongDays] = useState(initial.thresholdsLongDays);
  const [shortDays, setShortDays] = useState(initial.thresholdsShortDays);
  const [overdue, setOverdue] = useState(initial.overdueDays);
  const [cessation, setCessation] = useState(initial.cessationDay);
  const [autoChargeHours, setAutoChargeHours] = useState(
    initial.autoChargeReminderHours,
  );
  const [maxDelay, setMaxDelay] = useState(initial.autoChargeMaxDelayDays);
  const [firstPaymentDays, setFirstPaymentDays] = useState(initial.firstPaymentReminderDays);
  const [firstPaymentAdminDay, setFirstPaymentAdminDay] = useState(
    initial.firstPaymentAdminAlertDay,
  );
  const [templates, setTemplates] = useState(initial.templates);
  const [templateLang, setTemplateLang] = useState<TemplateLang>("it");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function patchTemplate(
    type: string,
    lang: TemplateLang,
    patch: Partial<TemplateField>,
  ) {
    setTemplates((ts) =>
      ts.map((t) => (t.type === type && t.lang === lang ? { ...t, ...patch } : t)),
    );
  }

  /** Override di una lingua: { TYPE: { subject, body } } (vuoto = default). */
  function templatesFor(lang: TemplateLang) {
    return Object.fromEntries(
      templates
        .filter((t) => t.lang === lang)
        .map((t) => [t.type, { subject: t.subject || null, body: t.body || null }]),
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
      autoChargeReminderHours: parseIntList(autoChargeHours),
      autoChargeMaxDelayDays: Math.min(10, Math.max(0, parseInt(maxDelay, 10) || 0)),
      firstPaymentReminderDays: parseIntList(firstPaymentDays).filter((n) => n >= 1),
      firstPaymentAdminAlertDay: Math.max(1, parseInt(firstPaymentAdminDay, 10) || 10),
      templatesByLocale: { it: templatesFor("it"), en: templatesFor("en") },
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
          <div className="sm:col-span-2">
            <label htmlFor="autoChargeHours" className="field-label">
              Solleciti attivazione rinnovo automatico · ore dalla richiesta
            </label>
            <input
              id="autoChargeHours"
              className="field"
              value={autoChargeHours}
              onChange={(e) => setAutoChargeHours(e.target.value)}
              placeholder="12, 24"
            />
            <p className="mt-1 text-xs text-slate-500">
              Alle soglie intermedie viene inviato un sollecito al cliente; alla
              soglia più alta scatta l&apos;escalation all&apos;admin.
            </p>
          </div>
          <div>
            <label htmlFor="autoChargeMaxDelay" className="field-label">
              Addebito automatico · ritardo massimo (giorni)
            </label>
            <input
              id="autoChargeMaxDelay"
              type="number"
              min={0}
              max={10}
              className="field"
              value={maxDelay}
              onChange={(e) => setMaxDelay(e.target.value)}
              placeholder="3"
            />
            <p className="mt-1 text-xs text-slate-500">
              Da 0 a 10. Le righe scadute da più giorni non vengono addebitate e
              sono segnalate all&apos;admin.
            </p>
          </div>
          <div>
            <label htmlFor="firstPaymentDays" className="field-label">
              Solleciti primo pagamento · giorni dall&apos;invio del link
            </label>
            <input
              id="firstPaymentDays"
              className="field"
              value={firstPaymentDays}
              onChange={(e) => setFirstPaymentDays(e.target.value)}
              placeholder="3, 7"
            />
            <p className="mt-1 text-xs text-slate-500">
              Email al cliente se l&apos;abbonamento &quot;da pagare&quot; non è
              ancora stato pagato.
            </p>
          </div>
          <div>
            <label htmlFor="firstPaymentAdminDay" className="field-label">
              Primo pagamento non ricevuto · avviso admin (giorni)
            </label>
            <input
              id="firstPaymentAdminDay"
              type="number"
              min={1}
              className="field"
              value={firstPaymentAdminDay}
              onChange={(e) => setFirstPaymentAdminDay(e.target.value)}
              placeholder="10"
            />
            <p className="mt-1 text-xs text-slate-500">
              Nessuna cessazione automatica: l&apos;abbonamento resta in attesa.
            </p>
          </div>
        </div>
      </section>

      {/* Testi email */}
      <section className="card space-y-5 p-6">
        <div>
          <h2 className="mono-label">Testi email</h2>
          <p className="mt-1 text-xs text-slate-500">
            Testi dell&apos;email inviata al CLIENTE. Lascia vuoto per usare il
            testo predefinito (mostrato come segnaposto; con più servizi nella
            stessa email si usa automaticamente la versione al plurale). Un
            testo personalizzato vale sia per uno sia per più servizi: usa{" "}
            <code className="font-mono text-[11px]">{"{serviceLines}"}</code>{" "}
            per elencarli. Ai clienti in inglese arrivano solo i testi della
            scheda English (o, se vuoti, i predefiniti in inglese). Segnaposto
            disponibili:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {placeholders[templateLang].map((p) => (
              <li key={p.token}>
                <code className="font-mono text-[11px] text-ink">{p.token}</code>{" "}
                — {p.description}
              </li>
            ))}
          </ul>
        </div>

        {/* Selettore lingua dei testi (stesso stile delle schede del Log). */}
        <div
          role="tablist"
          aria-label="Lingua dei testi email"
          className="flex gap-1 border-b border-line text-sm"
        >
          {(Object.keys(TEMPLATE_LANG_LABELS) as TemplateLang[]).map((lang) => {
            const active = templateLang === lang;
            const customized = templates.some(
              (t) => t.lang === lang && (t.subject || t.body),
            );
            return (
              <button
                key={lang}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTemplateLang(lang)}
                className={`-mb-px border-b-2 px-4 py-2 font-medium transition ${
                  active
                    ? "border-brand text-ink"
                    : "border-transparent text-slate-500 hover:text-ink"
                }`}
              >
                {TEMPLATE_LANG_LABELS[lang]}
                {customized ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-brand">
                    personalizzato
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="space-y-6">
          {templates
            .filter((t) => t.lang === templateLang)
            .map((t) => (
            <div
              key={`${t.type}-${t.lang}`}
              className="space-y-3 border-t border-line-soft pt-5 first:border-0 first:pt-0"
            >
              <h3 className="text-sm font-medium text-ink">{t.label}</h3>
              <div>
                <label
                  htmlFor={`subj-${t.type}-${t.lang}`}
                  className="field-label"
                >
                  Oggetto
                </label>
                <input
                  id={`subj-${t.type}-${t.lang}`}
                  className="field"
                  value={t.subject}
                  placeholder={t.defaultSubject}
                  onChange={(e) =>
                    patchTemplate(t.type, t.lang, { subject: e.target.value })
                  }
                />
              </div>
              <div>
                <label htmlFor={`body-${t.type}-${t.lang}`} className="field-label">
                  Corpo
                </label>
                <textarea
                  id={`body-${t.type}-${t.lang}`}
                  rows={3}
                  className="field"
                  value={t.body}
                  placeholder={t.defaultBody}
                  onChange={(e) =>
                    patchTemplate(t.type, t.lang, { body: e.target.value })
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
