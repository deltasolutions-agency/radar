"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteSiteButton, EnabledToggle } from "./site-actions";

// Azioni client della scheda sito (redesign): destinatari degli alert, email
// di prova, "ignora questo file", "segna tutti come visti", menu "⋯".

async function send(url: string, method: string, body?: unknown): Promise<{ error: string | null; data: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { error: null, data };
    const details = data.details && typeof data.details === "object" ? Object.values(data.details) : [];
    return { error: (details[0] as string | undefined) ?? data.error ?? "Operazione non riuscita", data };
  } catch {
    return { error: "Errore di rete, riprova", data: null };
  }
}

// ── Destinatari ────────────────────────────────────────────────────────────

export type RecipientRow = { id: string; email: string; mode: "ALL" | "CRITICAL" | "DIGEST" };

const MODES: { value: RecipientRow["mode"]; label: string }[] = [
  { value: "ALL", label: "Tutto" },
  { value: "CRITICAL", label: "Solo critici" },
  { value: "DIGEST", label: "Solo riepilogo" },
];

export function RecipientsManager({
  siteId,
  defaultEmail,
  recipients,
}: {
  siteId: string;
  defaultEmail: string;
  recipients: RecipientRow[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ error: string | null }>) {
    setBusy(key);
    setErr(null);
    const r = await fn();
    setBusy(null);
    if (r.error) setErr(r.error);
    else router.refresh();
    return !r.error;
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line-soft">
        <div className="flex flex-wrap items-center gap-3 bg-canvas/60 px-4 py-3">
          <span className="min-w-[14rem] flex-1 font-mono text-sm">{defaultEmail}</span>
          <span className="text-sm text-slate-600">Critici + riepilogo</span>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-slate-500">predefinito, tutti i siti</span>
        </div>
        {recipients.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-3">
            <span className="min-w-[14rem] flex-1 break-all font-mono text-sm">{r.email}</span>
            <div role="group" aria-label={`Cosa riceve ${r.email}`} className="inline-flex overflow-hidden rounded-lg border border-line">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={r.mode === m.value}
                  disabled={busy !== null}
                  onClick={() => r.mode !== m.value && run(r.id, () => send(`/api/vigilantes/recipients/${r.id}`, "PATCH", { mode: m.value }))}
                  className={
                    r.mode === m.value
                      ? "bg-ink px-3 py-2 text-xs font-medium text-white"
                      : "bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-canvas"
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run(r.id, () => send(`/api/vigilantes/recipients/${r.id}`, "DELETE"))}
              className="px-2 py-2 text-sm font-medium text-red-700 hover:underline"
              aria-label={`Rimuovi ${r.email}`}
            >
              Rimuovi
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim()) return;
          const ok = await run("add", () => send(`/api/vigilantes/sites/${siteId}/recipients`, "POST", { email, mode: "CRITICAL" }));
          if (ok) setEmail("");
        }}
      >
        <label className="min-w-[15rem] flex-1 text-xs text-slate-500" htmlFor={`rcpt-${siteId}`}>
          Aggiungi un indirizzo
          <input
            id={`rcpt-${siteId}`}
            type="email"
            className="field mt-1"
            placeholder="nome@dominio.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy !== null}>
          {busy === "add" ? "Aggiunta…" : "Aggiungi"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">I nuovi indirizzi partono con "Solo critici"; cambialo con i pulsanti accanto.</p>
      {err ? <p className="mt-2 text-sm font-medium text-red-700">{err}</p> : null}
    </div>
  );
}

export function TestEmailButton({ siteId }: { siteId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    const r = await send(`/api/vigilantes/sites/${siteId}/test-email`, "POST");
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    const results = ((r.data as { results?: { to: string; ok: boolean }[] })?.results ?? []);
    const failed = results.filter((x) => !x.ok);
    setMsg(
      failed.length
        ? { ok: false, text: `Non inviata a: ${failed.map((f) => f.to).join(", ")}` }
        : { ok: true, text: `Inviata a ${results.length} ${results.length === 1 ? "indirizzo" : "indirizzi"}` },
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
      <button type="button" className="btn-ghost" disabled={busy} onClick={run}>
        {busy ? "Invio…" : "Invia email di prova"}
      </button>
    </div>
  );
}

// ── Ignora file / segna come visti ─────────────────────────────────────────

export function IgnoreFileButton({ siteId, path, undo = false }: { siteId: string; path: string; undo?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        className="btn-ghost px-2.5 py-1.5 text-xs"
        title={undo ? "Torna a segnalarlo" : "Il file non verrà più segnalato su questo sito"}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await send(`/api/vigilantes/sites/${siteId}/ignore`, "POST", { path, undo });
          setBusy(false);
          if (r.error) setErr(r.error);
          else router.refresh();
        }}
      >
        {busy ? "Ricontrollo…" : undo ? "Torna a segnalare" : "È innocuo, ignora"}
      </button>
      {err ? <span className="mt-1 text-xs text-red-700">{err}</span> : null}
    </span>
  );
}

export function BulkAckButton({ alertIds, label }: { alertIds: string[]; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (alertIds.length === 0) return null;
  return (
    <button
      type="button"
      className="btn-ghost px-3 py-1.5 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        for (const id of alertIds) await send(`/api/vigilantes/alerts/${id}/ack`, "POST", {});
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Aggiorno…" : label}
    </button>
  );
}

// ── Menu "⋯" (pausa, elimina) ──────────────────────────────────────────────

export function SiteMenu({ siteId, enabled, label }: { siteId: string; enabled: boolean; label: string }) {
  // Niente chiusura al click esterno: la conferma "ELIMINA" apre un popup
  // fuori dal menu, che altrimenti verrebbe smontato.
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        className="btn-ghost px-3"
        aria-label="Altre azioni"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div className="card absolute right-0 z-40 mt-2 flex w-56 flex-col gap-2 p-3 shadow-lg">
          <EnabledToggle siteId={siteId} enabled={enabled} />
          <DeleteSiteButton siteId={siteId} label={label} />
        </div>
      ) : null}
    </div>
  );
}
