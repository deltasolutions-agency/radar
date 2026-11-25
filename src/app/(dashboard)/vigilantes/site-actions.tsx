"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DELETE_CONFIRM_WORD } from "@/lib/delete-confirm";

// ── Condivisi ──────────────────────────────────────────────────────────────

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

export type ClientOption = { id: string; label: string };

// ── Nuovo sito / modifica ──────────────────────────────────────────────────

export type SiteEditable = {
  id: string;
  name: string;
  url: string;
  clientId: string | null;
  notes: string | null;
};

export function SiteFormButton({ clients, site }: { clients: ClientOption[]; site?: SiteEditable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", url: "", clientId: "", notes: "" });
  const idp = site ? `site-${site.id}` : "site-new";

  function start() {
    setErr(null);
    setForm({
      name: site?.name ?? "",
      url: site?.url ?? "",
      clientId: site?.clientId ?? "",
      notes: site?.notes ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!form.url.trim()) return setErr("Indica l'URL del sito.");
    setBusy(true);
    setErr(null);
    const payload = {
      name: form.name.trim() || form.url.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
      url: form.url,
      clientId: form.clientId || null,
      notes: form.notes,
    };
    const r = site
      ? await send(`/api/vigilantes/sites/${site.id}`, "PATCH", payload)
      : await send("/api/vigilantes/sites", "POST", payload);
    setBusy(false);
    if (r.error) return setErr(r.error);
    setOpen(false);
    if (!site) {
      const id = (r.data as { site?: { id: string } })?.site?.id;
      if (id) return router.push(`/vigilantes/${id}`);
    }
    router.refresh();
  }

  const set = (k: keyof typeof form) => (ev: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  return (
    <>
      {site ? (
        <button type="button" className="btn-ghost" onClick={start}>
          Modifica
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={start}>
          + Nuovo sito
        </button>
      )}
      {open ? (
        <Dialog title={site ? "Modifica sito" : "Nuovo sito WordPress"} onClose={() => setOpen(false)} busy={busy}>
          <form
            className="mt-3 space-y-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-url`}>
              URL del sito
              <input
                id={`${idp}-url`}
                className="field mt-1 font-mono"
                value={form.url}
                maxLength={300}
                placeholder="https://www.sito.it"
                autoFocus
                onChange={set("url")}
              />
            </label>
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-name`}>
              Nome (facoltativo)
              <input
                id={`${idp}-name`}
                className="field mt-1"
                value={form.name}
                maxLength={200}
                placeholder="es. SIFEIT"
                onChange={set("name")}
              />
            </label>
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-client`}>
              Cliente (facoltativo)
              <select id={`${idp}-client`} className="field mt-1" value={form.clientId} onChange={set("clientId")}>
                <option value="">— Nessuno —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-500" htmlFor={`${idp}-notes`}>
              Note (facoltative)
              <textarea
                id={`${idp}-notes`}
                className="field mt-1 min-h-[4rem]"
                value={form.notes}
                maxLength={2000}
                onChange={set("notes")}
              />
            </label>
            {!site ? (
              <p className="text-xs text-slate-500">
                Dopo il salvataggio trovi la chiave di collegamento da incollare nel plugin Radar Vigilantes.
              </p>
            ) : null}
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

// ── Controlla ora ──────────────────────────────────────────────────────────

export function CheckNowButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const r = await send(`/api/vigilantes/sites/${siteId}/check`, "POST");
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    const res = (r.data as { result?: { ok: boolean; error?: string; updates?: number } })?.result;
    setMsg(
      res?.ok
        ? { ok: true, text: res.updates ? `${res.updates} aggiornamenti disponibili` : "Tutto aggiornato" }
        : { ok: false, text: res?.error ?? "Controllo non riuscito" },
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-primary" disabled={busy} onClick={run}>
        {busy ? "Controllo in corso…" : "Controlla ora"}
      </button>
      {msg ? (
        <p className={`max-w-xs text-right text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}

// ── Chiave di collegamento ─────────────────────────────────────────────────

export function ConnectionKeyPanel({
  siteId,
  connectionKey,
  fingerprint,
}: {
  siteId: string;
  connectionKey: string;
  fingerprint: string;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(connectionKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShown(true);
    }
  }

  async function rotate() {
    setBusy(true);
    setErr(null);
    const r = await send(`/api/vigilantes/sites/${siteId}/secret`, "POST");
    setBusy(false);
    if (r.error) return setErr(r.error);
    setConfirm(false);
    setShown(true);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Incolla questa chiave in <strong>Impostazioni → Radar Vigilantes</strong> sul sito WordPress. Contiene il
        secret del sito: non condividerla.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs">
          {shown ? connectionKey : `rv1.••••••••••••••••  (impronta ${fingerprint})`}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={copy}>
          {copied ? "Copiata ✓" : "Copia chiave"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setShown((s) => !s)}>
          {shown ? "Nascondi" : "Mostra"}
        </button>
        <button type="button" className="btn-danger" onClick={() => setConfirm(true)}>
          Rigenera
        </button>
      </div>
      {confirm ? (
        <Dialog title="Rigenerare la chiave?" onClose={() => setConfirm(false)} busy={busy}>
          <p className="mt-2 text-sm text-slate-600">
            La chiave attuale smette subito di funzionare: finché non incolli quella nuova nel plugin, Radar non
            riceverà più report da questo sito.
          </p>
          {err ? <p className="mt-3 text-sm font-medium text-red-700">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-danger" disabled={busy} onClick={rotate}>
              {busy ? "Rigenerazione…" : "Sì, rigenera"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm(false)}>
              Annulla
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

// ── Alert: visto ───────────────────────────────────────────────────────────

export function AckButton({ alertId, acknowledged, sticky }: { alertId: string; acknowledged: boolean; sticky: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    await send(`/api/vigilantes/alerts/${alertId}/ack`, "POST", acknowledged ? { undo: true } : {});
    setBusy(false);
    router.refresh();
  }
  return (
    <button
      type="button"
      className="btn-ghost px-2.5 py-1.5 text-xs"
      disabled={busy}
      onClick={run}
      title={
        acknowledged
          ? "Torna nel riepilogo giornaliero"
          : sticky
            ? "Chiude l'alert"
            : "Resta aperto ma esce dal riepilogo finché non cambia"
      }
    >
      {acknowledged ? "Annulla visto" : sticky ? "Verificato, chiudi" : "Segna come visto"}
    </button>
  );
}

// ── Pausa ──────────────────────────────────────────────────────────────────

export function EnabledToggle({ siteId, enabled }: { siteId: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await send(`/api/vigilantes/sites/${siteId}`, "PATCH", { enabled: !enabled });
    setBusy(false);
    router.refresh();
  }
  return (
    <button type="button" className="btn-ghost" disabled={busy} onClick={toggle}>
      {enabled ? "Metti in pausa" : "Riattiva"}
    </button>
  );
}

// ── Elimina (conferma "ELIMINA") ───────────────────────────────────────────

export function DeleteSiteButton({ siteId, label }: { siteId: string; label: string }) {
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
    const r = await send(`/api/vigilantes/sites/${siteId}`, "DELETE", { confirmText: text.trim() });
    setBusy(false);
    if (r.error) return setErr(r.error);
    router.push("/vigilantes");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="btn-danger"
        onClick={() => {
          setText("");
          setErr(null);
          setOpen(true);
        }}
      >
        Elimina
      </button>
      {open ? (
        <Dialog title="Eliminare questo sito?" onClose={() => setOpen(false)} busy={busy}>
          <p className="mt-2 text-sm text-slate-600">
            «{label}» verrà tolto da Vigilantes con tutti i suoi componenti e alert. Il plugin sul sito non verrà
            più accettato. Scrivi <strong>{DELETE_CONFIRM_WORD}</strong> per confermare.
          </p>
          <label className="mt-3 block text-xs text-slate-500" htmlFor={`del-site-${siteId}`}>
            Conferma
            <input
              id={`del-site-${siteId}`}
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

// ── Scansione approfondita ─────────────────────────────────────────────────

export function DeepScanToggle({ siteId, enabled }: { siteId: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setErr(null);
    const r = await send(`/api/vigilantes/sites/${siteId}`, "PATCH", { deepScan: !enabled });
    setBusy(false);
    if (r.error) return setErr(r.error);
    router.refresh();
  }
  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2">
        <span className="relative inline-block h-5 w-9 shrink-0">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={busy}
            onChange={toggle}
            aria-label="Scansione approfondita"
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
        <span className="text-sm font-medium text-ink">Scansione approfondita {enabled ? "attiva" : "spenta"}</span>
      </label>
      {err ? <p className="mt-1 text-xs text-red-700">{err}</p> : null}
    </div>
  );
}
