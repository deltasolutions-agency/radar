"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";
import { parseEuroToCents } from "@/lib/ledger";
import { COST_CATEGORY_LABELS, COST_PERIODS } from "@/lib/costs";

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

/** "33,33" / "33.33" / "" → numero o null (quota uguale). undefined = non valido. */
function parseShare(input: string): number | null | undefined {
  const s = input.trim().replace("%", "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

// ── Nuovo costo / modifica ─────────────────────────────────────────────────

export type CostEditable = {
  id: string;
  name: string;
  supplier: string | null;
  category: string | null;
  amountCents: number;
  periodMonths: number;
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
            <label className="text-xs text-slate-500" htmlFor={`c-${id}-renewal`}>
              Prossimo rinnovo
              <input id={`c-${id}-renewal`} type="date" className="field mt-1" value={v.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} />
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
          <p className="mt-2 text-xs text-slate-500">Importo come pagato, senza calcolo IVA. Lo ripartisci sugli abbonamenti dalla scheda del costo.</p>
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

// ── Collegamenti costo ↔ abbonamento ───────────────────────────────────────

export type Option = { id: string; label: string };

/**
 * Collega: dalla scheda costo (mode "subscription": scegli l'abbonamento) o
 * dalla scheda abbonamento (mode "cost": scegli il costo).
 */
export function AddAllocationForm({
  mode,
  fixedId,
  options,
}: {
  mode: "subscription" | "cost";
  fixedId: string;
  options: Option[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputId = `alloc-${fixedId}`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return setErr(mode === "subscription" ? "Scegli un abbonamento" : "Scegli un costo");
    const sharePercent = parseShare(share);
    if (sharePercent === undefined) return setErr("Quota tra 0,01 e 100, oppure vuota per dividere in parti uguali");
    setBusy(true);
    setErr(null);
    const costId = mode === "subscription" ? fixedId : target;
    const subscriptionId = mode === "subscription" ? target : fixedId;
    const r = await send(`/api/costs/${costId}/allocations`, "POST", { subscriptionId, sharePercent });
    setBusy(false);
    if (r) return setErr(r);
    setTarget("");
    setShare("");
    router.refresh();
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {mode === "subscription" ? "Collegato a tutti gli abbonamenti disponibili." : "Nessun costo da collegare: inseriscili in Amministrazione → Costi."}
      </p>
    );
  }
  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-2">
      <label className="min-w-[16rem] flex-1 text-xs text-slate-500" htmlFor={inputId}>
        {mode === "subscription" ? "Abbonamento che lo usa" : "Costo"}
        <select id={inputId} className="field mt-1" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— Seleziona —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="w-36 text-xs text-slate-500" htmlFor={`${inputId}-share`}>
        Quota % (facoltativa)
        <input id={`${inputId}-share`} className="field mt-1" inputMode="decimal" placeholder="parti uguali" value={share} onChange={(e) => setShare(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Collego…" : "Collega"}
      </button>
      {err ? <p className="w-full text-sm font-medium text-red-700">{err}</p> : null}
    </form>
  );
}

/** Quota modificabile in linea + scollega. */
export function AllocationControls({ id, sharePercent }: { id: string; sharePercent: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sharePercent === null ? "" : String(sharePercent).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setErr(null);
    const e = await fn();
    setBusy(false);
    if (e) return setErr(e);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {editing ? (
        <>
          <input
            className="field w-24 py-1 text-xs"
            inputMode="decimal"
            placeholder="parti uguali"
            aria-label="Quota %"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => {
              const s = parseShare(value);
              if (s === undefined) return setErr("Quota tra 0,01 e 100");
              run(() => send(`/api/cost-allocations/${id}`, "PATCH", { sharePercent: s }));
            }}
          >
            Salva
          </button>
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => setEditing(false)}>
            Annulla
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
            Quota
          </button>
          <button
            type="button"
            className="px-2 py-1.5 text-xs font-medium text-red-700 hover:underline"
            disabled={busy}
            onClick={() => run(() => send(`/api/cost-allocations/${id}`, "DELETE"))}
          >
            Scollega
          </button>
        </>
      )}
      {err ? <span className="w-full text-right text-xs text-red-700">{err}</span> : null}
    </div>
  );
}
