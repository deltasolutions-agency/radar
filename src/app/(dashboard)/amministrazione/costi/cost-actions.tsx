"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";
import { parseEuroToCents } from "@/lib/ledger";
import { COST_CATEGORY_LABELS, COST_PERIODS, COST_VAT_RATE } from "@/lib/costs";

// Azioni client della sezione Amministrazione → Costi e del riquadro
// "Costi e margine" nella scheda abbonamento.

function Dialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5 text-left">
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const details = data.details && typeof data.details === "object" ? Object.values(data.details) : [];
    return (details[0] as string | undefined) ?? data.error ?? "Salvataggio non riuscito";
  } catch {
    return "Errore di rete, riprova";
  }
}

const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

// ── Nuovo costo / modifica ─────────────────────────────────────────────────

export type CostEditable = {
  id: string;
  name: string;
  supplier: string | null;
  category: string | null;
  amountCents: number;
  periodMonths: number;
  vatPercent: number;
  general: boolean;
  recurring: boolean;
  renewalDate: string | null;
  notes: string | null;
  active: boolean;
};

export function CostButton({ cost }: { cost?: CostEditable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(() => ({
    name: cost?.name ?? "",
    supplier: cost?.supplier ?? "",
    category: cost?.category ?? "",
    amount: cost ? centsToInput(cost.amountCents) : "",
    periodMonths: String(cost?.periodMonths ?? 12),
    vatIncluded: (cost?.vatPercent ?? 0) > 0,
    general: cost?.general ?? false,
    recurring: cost?.recurring ?? false,
    renewalDate: cost?.renewalDate ?? "",
    notes: cost?.notes ?? "",
    active: cost?.active ?? true,
  }));
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  async function save() {
    const amountCents = parseEuroToCents(v.amount);
    if (amountCents === null) return setErr("Importo non valido (es. 120,00)");
    setBusy(true);
    setErr(null);
    const e = await send(cost ? `/api/costs/${cost.id}` : "/api/costs", cost ? "PATCH" : "POST", {
      name: v.name,
      supplier: v.supplier,
      category: v.category,
      amountCents,
      periodMonths: Number(v.periodMonths),
      vatPercent: v.vatIncluded ? COST_VAT_RATE : 0,
      general: v.general,
      recurring: v.recurring,
      renewalDate: v.renewalDate,
      notes: v.notes,
      active: v.active,
    });
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false);
    router.refresh();
  }

  const id = cost?.id ?? "new";
  return (
    <>
      <button type="button" className={cost ? "btn-ghost px-2.5 py-1.5 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        {cost ? "Modifica" : "+ Nuovo costo"}
      </button>
      {open ? (
        <Dialog title={cost ? "Modifica costo" : "Nuovo costo"} onClose={() => setOpen(false)} busy={busy}>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500 sm:col-span-2" htmlFor={`c-${id}-name`}>
              Nome <span className="text-red-600">*</span>
              <input
                id={`c-${id}-name`}
                className="field mt-1"
                value={v.name}
                autoFocus
                placeholder="es. Hosting condiviso Hostinger Business"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-supplier`}>
              Fornitore
              <input id={`c-${id}-supplier`} className="field mt-1" value={v.supplier} placeholder="es. Hostinger" onChange={(e) => set({ supplier: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-cat`}>
              Categoria
              <select id={`c-${id}-cat`} className="field mt-1" value={v.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">—</option>
                {Object.entries(COST_CATEGORY_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-amount`}>
              Quanto l&apos;hai pagato (€) <span className="text-red-600">*</span>
              <input
                id={`c-${id}-amount`}
                className="field mt-1"
                inputMode="decimal"
                value={v.amount}
                placeholder="es. 119,88"
                onChange={(e) => set({ amount: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-period`}>
              Ogni
              <select id={`c-${id}-period`} className="field mt-1" value={v.periodMonths} onChange={(e) => set({ periodMonths: e.target.value })}>
                {COST_PERIODS.map((p) => (
                  <option key={p.months} value={p.months}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-line-soft bg-canvas p-3 text-sm sm:col-span-2" htmlFor={`c-${id}-general`}>
              <input
                id={`c-${id}-general`}
                type="checkbox"
                className="mt-0.5"
                checked={v.general}
                onChange={(e) => set({ general: e.target.checked })}
              />
              <span>
                Costo generale
                <span className="mt-0.5 block text-xs text-slate-500">
                  Non legato a nessun abbonamento (es. commercialista, software interni): pesa sul margine complessivo e non si richiama nei
                  singoli abbonamenti.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-line-soft bg-canvas p-3 text-sm sm:col-span-2" htmlFor={`c-${id}-vat`}>
              <input
                id={`c-${id}-vat`}
                type="checkbox"
                className="mt-0.5"
                checked={v.vatIncluded}
                onChange={(e) => set({ vatIncluded: e.target.checked })}
              />
              <span>
                IVA inclusa ({COST_VAT_RATE}%), detraibile
                <span className="mt-0.5 block text-xs text-slate-500">
                  Spunta se nell&apos;importo c&apos;è IVA che detrai: nei margini Radar usa il netto. Senza spunta il costo conta per intero.
                </span>
              </span>
            </label>
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-renewal`}>
              Prossimo rinnovo
              <input id={`c-${id}-renewal`} type="date" min="2000-01-01" max="2100-12-31" className="field mt-1" value={v.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} />
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-line-soft bg-canvas p-3 text-sm sm:col-span-2" htmlFor={`c-${id}-recurring`}>
              <input
                id={`c-${id}-recurring`}
                type="checkbox"
                className="mt-0.5"
                checked={v.recurring}
                onChange={(e) => set({ recurring: e.target.checked })}
              />
              <span>
                Ricorrente (si rinnova da solo)
                <span className="mt-0.5 block text-xs text-slate-500">
                  Passata la data di rinnovo, Radar la sposta avanti di un periodo. Da 7 giorni prima ricevi ogni giorno alle 10:00 un avviso
                  su hello@. Serve la data del prossimo rinnovo.
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm" htmlFor={`c-${id}-active`}>
              <input id={`c-${id}-active`} type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
              Costo in uso
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2" htmlFor={`c-${id}-notes`}>
              Note
              <textarea id={`c-${id}-notes`} rows={2} className="field mt-1" value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Inserisci l&apos;importo come l&apos;hai pagato. Poi lo richiami negli abbonamenti che lo usano: si divide in parti uguali tra loro.</p>
          {err ? <p className="mt-3 text-sm font-medium text-red-700">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? "Salvataggio…" : "Salva"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Annulla
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function CostDeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const matches = text.trim() === DELETE_CONFIRM_WORD;
  return (
    <>
      <button type="button" className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => (setText(""), setErr(null), setOpen(true))}>
        Elimina
      </button>
      {open ? (
        <Dialog title="Eliminare questo costo?" onClose={() => setOpen(false)} busy={busy}>
          <p className="mt-2 text-sm text-slate-600">
            «{label}» e i suoi collegamenti agli abbonamenti verranno eliminati. Se non lo paghi più, basta togliere la spunta &quot;Costo in uso&quot;.
            Scrivi <strong>{DELETE_CONFIRM_WORD}</strong> per confermare.
          </p>
          <input className="field mt-3 font-mono" value={text} autoFocus autoComplete="off" aria-label="Conferma" onChange={(e) => setText(e.target.value)} />
          {err ? <p className="mt-3 text-sm font-medium text-red-700">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={busy || !matches}
              onClick={async () => {
                setBusy(true);
                const e = await send(`/api/costs/${id}`, "DELETE", { confirmText: text.trim() });
                setBusy(false);
                if (e) return setErr(e);
                setOpen(false);
                router.push("/amministrazione/costi");
                router.refresh();
              }}
            >
              {busy ? "Eliminazione…" : "Elimina"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Annulla
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

// ── Costi richiamati in un abbonamento ─────────────────────────────────────

export type Option = { id: string; label: string };

/** Scheda abbonamento: richiama un costo scrivendo per filtrare l'elenco. */
export function AddCostToSubscription({ subscriptionId, options }: { subscriptionId: string; options: Option[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listId = `costlist-${subscriptionId}`;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((o) => {
    const l = o.label.toLowerCase();
    return words.every((w) => l.includes(w));
  });

  async function pick(o: Option) {
    setBusy(true);
    setErr(null);
    setOpen(false);
    const r = await send(`/api/costs/${o.id}/allocations`, "POST", { subscriptionId });
    setBusy(false);
    if (r) return setErr(r);
    setQuery("");
    router.refresh();
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nessun altro costo da richiamare.{" "}
        <a href="/amministrazione/costi" className="text-brand hover:underline">
          Aggiungi i tuoi costi
        </a>
        .
      </p>
    );
  }
  return (
    <div className="relative">
      <label className="block text-xs text-slate-500" htmlFor={`${listId}-input`}>
        Richiama un costo
      </label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        className="field mt-1"
        placeholder="Scrivi per cercare: dominio, hosting, nome del sito, fornitore…"
        autoComplete="off"
        disabled={busy}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && matches[active]) pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">Nessun costo corrisponde a &quot;{query}&quot;.</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-canvas text-ink" : "text-slate-700"}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-slate-500">{busy ? "Aggiungo…" : "Clicca un costo (o premi Invio) per aggiungerlo."}</p>
      {err ? <p className="mt-1 text-sm font-medium text-red-700">{err}</p> : null}
    </div>
  );
}

/** Toglie il costo dall'abbonamento: la quota si ridivide sugli altri. */
export function UnlinkCostButton({ allocationId }: { allocationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        className="px-2 py-1.5 text-xs font-medium text-red-700 hover:underline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const e = await send(`/api/cost-allocations/${allocationId}`, "DELETE");
          setBusy(false);
          if (e) return setErr(e);
          router.refresh();
        }}
      >
        {busy ? "Tolgo…" : "Togli"}
      </button>
      {err ? <span className="text-xs text-red-700">{err}</span> : null}
    </span>
  );
}

/** Interruttore rapido "Ricorrente" dall'elenco dei costi. */
export function RecurringToggle({ id, recurring, hasDate }: { id: string; recurring: boolean; hasDate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="mt-1 inline-flex flex-col">
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600" title={hasDate ? undefined : "Indica prima la data di rinnovo (Modifica)"}>
        <input
          type="checkbox"
          checked={recurring}
          disabled={busy || (!hasDate && !recurring)}
          onChange={async (e) => {
            setBusy(true);
            setErr(null);
            const r = await send(`/api/costs/${id}/recurring`, "PATCH", { recurring: e.target.checked });
            setBusy(false);
            if (r) return setErr(r);
            router.refresh();
          }}
        />
        ricorrente
      </label>
      {err ? <span className="text-xs text-red-700">{err}</span> : null}
    </span>
  );
}
