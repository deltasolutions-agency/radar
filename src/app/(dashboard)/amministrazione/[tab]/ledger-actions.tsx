"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";
import { LEDGER_TEXT, formatDay, parseEuroToCents, type LedgerKindValue } from "@/lib/ledger";

// ── Popup condiviso ────────────────────────────────────────────────────────

function Dialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
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
      <div className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-5 text-left">
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const details = data.details && typeof data.details === "object" ? Object.values(data.details) : [];
    return (details[0] as string | undefined) ?? data.error ?? "Salvataggio non riuscito";
  } catch {
    return "Errore di rete, riprova";
  }
}

/** Centesimi → "1234,56" per il campo importo. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// ── Nuova voce / modifica ──────────────────────────────────────────────────

export type LedgerEntryEditable = {
  id: string;
  counterparty: string;
  description: string | null;
  amountCents: number;
  dueDate: string | null;
  notes: string | null;
};

/** Senza `entry`: pulsante "Nuovo credito/dovuto". Con `entry`: "Modifica". */
export function LedgerEntryButton({
  kind,
  entry,
}: {
  kind: LedgerKindValue;
  entry?: LedgerEntryEditable;
}) {
  const router = useRouter();
  const t = LEDGER_TEXT[kind];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ counterparty: "", description: "", amount: "", dueDate: "", notes: "" });
  const idp = entry ? `ledger-${entry.id}` : `ledger-new-${kind}`;

  function start() {
    setErr(null);
    setForm({
      counterparty: entry?.counterparty ?? "",
      description: entry?.description ?? "",
      amount: entry ? centsToInput(entry.amountCents) : "",
      dueDate: entry?.dueDate ?? "",
      notes: entry?.notes ?? "",
    });
    setOpen(true);
  }

  async function save() {
    const amountCents = parseEuroToCents(form.amount);
    if (!form.counterparty.trim()) return setErr(`Compila "${t.counterparty}".`);
    if (amountCents === null || amountCents <= 0) return setErr("Importo non valido: usa per esempio 1.250,00");
    setBusy(true);
    setErr(null);
    const payload = {
      counterparty: form.counterparty,
      description: form.description,
      amountCents,
      dueDate: form.dueDate || null,
      notes: form.notes,
    };
    const e = entry
      ? await send(`/api/ledger/${entry.id}`, "PATCH", payload)
      : await send("/api/ledger", "POST", { kind, ...payload });
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false);
    router.refresh();
  }

  const set = (k: keyof typeof form) => (ev: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  return (
    <>
      {entry ? (
        <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={start}>
          Modifica
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={start}>
          + {t.newEntry}
        </button>
      )}
      {open ? (
        <Dialog title={entry ? `Modifica · ${t.tab}` : t.newEntry} onClose={() => setOpen(false)} busy={busy}>
          <form
            className="mt-3 space-y-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-cp`}>
              {t.counterparty}
              <input
                id={`${idp}-cp`}
                className="field mt-1"
                value={form.counterparty}
                maxLength={200}
                placeholder={t.counterpartyPlaceholder}
                autoFocus
                onChange={set("counterparty")}
              />
            </label>
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-desc`}>
              Descrizione (facoltativa)
              <input
                id={`${idp}-desc`}
                className="field mt-1"
                value={form.description}
                maxLength={500}
                placeholder="es. Sito web, saldo fattura 12/2026"
                onChange={set("description")}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-slate-500" htmlFor={`${idp}-amount`}>
                Importo (€)
                <input
                  id={`${idp}-amount`}
                  className="field mt-1 tabular-nums"
                  value={form.amount}
                  inputMode="decimal"
                  placeholder="1.250,00"
                  onChange={set("amount")}
                />
              </label>
              <label className="block text-xs text-slate-500" htmlFor={`${idp}-due`}>
                Scadenza (facoltativa)
                <input
                  id={`${idp}-due`}
                  type="date"
                  className="field mt-1"
                  value={form.dueDate}
                  onChange={set("dueDate")}
                />
              </label>
            </div>
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-notes`}>
              Note (facoltative)
              <textarea
                id={`${idp}-notes`}
                className="field mt-1 min-h-[4.5rem]"
                value={form.notes}
                maxLength={2000}
                onChange={set("notes")}
              />
            </label>
            <p className="text-xs text-slate-500">
              Importo così come lo scrivi, senza calcolo IVA. Senza scadenza non partono alert.
              {entry ? " Se cambi la scadenza, gli alert ripartono dalla nuova data." : ""}
            </p>
            {err ? <p className="text-sm font-medium text-red-700">{err}</p> : null}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Salvataggio…" : "Salva"}
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
                Annulla
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

// ── Pagato / incassato ─────────────────────────────────────────────────────

/** Interruttore Sì/No come "Fatturato" in Pagamenti: data (default oggi) e nota. */
export function LedgerPaidToggle({
  id,
  kind,
  paidDate,
  paidNote,
  today,
}: {
  id: string;
  kind: LedgerKindValue;
  paidDate: string | null;
  paidNote: string | null;
  today: string;
}) {
  const router = useRouter();
  const t = LEDGER_TEXT[kind];
  const paid = !!paidDate;
  const [dialog, setDialog] = useState<"on" | "off" | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function open(next: boolean) {
    setErr(null);
    if (next) {
      setDate(today);
      setNote("");
    }
    setDialog(next ? "on" : "off");
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const e = await send(
      `/api/ledger/${id}`,
      "PATCH",
      dialog === "on" ? { paid: true, paidDate: date || null, paidNote: note } : { paid: false },
    );
    setBusy(false);
    if (e) return setErr(e);
    setDialog(null);
    router.refresh();
  }

  return (
    <div className="min-w-[7rem]">
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span className="relative inline-block h-5 w-9 shrink-0">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={paid}
            onChange={(e) => open(e.target.checked)}
            aria-label={t.paid}
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
        <span className="text-xs text-ink">{paid ? "Sì" : "No"}</span>
      </label>
      {paid ? (
        <p className="mt-1 text-xs text-slate-500">
          {formatDay(paidDate)}
          {paidNote ? ` · ${paidNote}` : ""}
        </p>
      ) : null}

      {dialog ? (
        <Dialog title={dialog === "on" ? t.paidAction : t.unpaidAction} onClose={() => setDialog(null)} busy={busy}>
          {dialog === "on" ? (
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-slate-500" htmlFor={`paid-${id}-date`}>
                Data
                <input
                  id={`paid-${id}-date`}
                  type="date"
                  className="field mt-1"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-500" htmlFor={`paid-${id}-note`}>
                Nota (facoltativa)
                <input
                  id={`paid-${id}-note`}
                  className="field mt-1"
                  value={note}
                  maxLength={300}
                  placeholder="es. bonifico, contanti"
                  autoFocus
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              La voce torna aperta: data e nota del pagamento verranno cancellate e, se è scaduta,
              gli alert ripartono.
            </p>
          )}
          {err ? <p className="mt-3 text-sm font-medium text-red-700">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? "Salvataggio…" : dialog === "on" ? "Salva" : "Sì, riapri"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDialog(null)}>
              Annulla
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

// ── Elimina (conferma "ELIMINA") ───────────────────────────────────────────

export function LedgerDeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const matches = text.trim() === DELETE_CONFIRM_WORD;

  async function del() {
    if (!matches) return;
    setBusy(true);
    setErr(null);
    const e = await send(`/api/ledger/${id}`, "DELETE", { confirmText: text.trim() });
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="btn-danger px-2.5 py-1.5 text-xs"
        onClick={() => {
          setText("");
          setErr(null);
          setOpen(true);
        }}
      >
        Elimina
      </button>
      {open ? (
        <Dialog title="Eliminare questa voce?" onClose={() => setOpen(false)} busy={busy}>
          <p className="mt-2 text-sm text-slate-600">
            «{label}» verrà eliminata definitivamente. Scrivi <strong>{DELETE_CONFIRM_WORD}</strong> per
            confermare.
          </p>
          <label className="mt-3 block text-xs text-slate-500" htmlFor={`del-${id}`}>
            Conferma
            <input
              id={`del-${id}`}
              className="field mt-1 font-mono"
              value={text}
              autoFocus
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {err ? <p className="mt-3 text-sm font-medium text-red-700">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-danger" disabled={busy || !matches} onClick={del}>
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
