"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Soglie di margine delle card gialla/rossa, modificabili dalla dashboard. */
export function MarginThresholds({ warn, alert }: { warn: number; alert: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [w, setW] = useState(String(warn));
  const [a, setA] = useState(String(alert));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/settings/dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marginWarnPercent: Number(w), marginAlertPercent: Number(a) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = data.details && typeof data.details === "object" ? Object.values(data.details) : [];
        setErr((details[0] as string | undefined) ?? data.error ?? "Salvataggio non riuscito");
      } else {
        setEditing(false);
        router.refresh();
      }
    } catch {
      setErr("Errore di rete, riprova");
    }
    setBusy(false);
  }

  if (!editing) {
    return (
      <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setEditing(true)}>
        Soglie: giallo sotto {warn}%, rosso sotto {alert}% · modifica
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs text-slate-500">
      <label>
        Giallo sotto (%)
        <input className="field mt-1 w-20 py-1" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} />
      </label>
      <label>
        Rosso sotto (%)
        <input className="field mt-1 w-20 py-1" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} />
      </label>
      <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={save}>
        {busy ? "Salvo…" : "Salva"}
      </button>
      <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setEditing(false)}>
        Annulla
      </button>
      {err ? <span className="w-full text-red-700">{err}</span> : null}
    </div>
  );
}
