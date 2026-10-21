"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatEur } from "@/lib/format";
import { AUTOCHARGE_CONFIRM_WORD } from "@/lib/cron/meta";
import { CronDetailsTable } from "./cron-details-table";

type Preview = {
  previewedAt: string;
  candidates: number;
  skipped: number;
  wouldSend?: number;
  wouldCharge?: number;
  details: Record<string, unknown>[];
};

/**
 * Controllo di un cron: interruttore Attivo/In pausa, anteprima (dry-run) ed
 * "Esegui ora" (solo dopo l'anteprima, con conferma; per l'auto-charge la
 * parola ADDEBITA e l'importo totale).
 */
export function CronControl({
  name,
  label,
  schedule,
  charges,
  enabled,
  statusBadge,
  lastRunLabel,
}: {
  name: string;
  label: string;
  schedule: string;
  charges: boolean;
  enabled: boolean;
  statusBadge: { text: string; tone: "ok" | "bad" | "muted" };
  lastRunLabel: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "toggle" | "preview" | "run">(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; runId?: string } | null>(null);

  const total = preview
    ? preview.details
        .filter((d) => d.outcome === "WOULD_CHARGE")
        .reduce((s, d) => s + (typeof d.totalCents === "number" ? d.totalCents : 0), 0)
    : 0;

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { res, body: await res.json().catch(() => ({})) };
  }

  async function toggle() {
    setBusy("toggle");
    setMsg(null);
    const { res, body } = await call(`/api/admin/cron/${name}`, "PATCH", { enabled: !enabled });
    if (!res.ok) setMsg({ ok: false, text: body.error ?? "Operazione non riuscita" });
    setBusy(null);
    router.refresh();
  }

  async function loadPreview() {
    setBusy("preview");
    setMsg(null);
    setConfirming(false);
    const { res, body } = await call(`/api/admin/cron/${name}/preview`, "POST");
    if (res.ok) setPreview(body as Preview);
    else setMsg({ ok: false, text: body.error ?? "Anteprima non riuscita" });
    setBusy(null);
  }

  async function run() {
    if (!preview) return;
    setBusy("run");
    setMsg(null);
    const { res, body } = await call(`/api/admin/cron/${name}/run`, "POST", {
      previewedAt: preview.previewedAt,
      ...(charges ? { confirm: word } : {}),
    });
    if (res.ok) {
      setMsg({
        ok: true,
        text: `Eseguito: ${body.sent} ${charges ? "addebiti riusciti" : "inviati"}, ${body.skipped} saltati, ${body.failed} falliti.`,
        runId: body.runId,
      });
      setPreview(null);
      setConfirming(false);
      setWord("");
    } else {
      setMsg({ ok: false, text: body.error ?? "Esecuzione non riuscita", runId: body.details?.runId });
    }
    setBusy(null);
    router.refresh();
  }

  const toneCls = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bad: "border-red-200 bg-red-50 text-red-700",
    muted: "border-slate-200 bg-slate-100 text-slate-600",
  }[statusBadge.tone];

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-ink">{label}</h3>
          <p className="text-xs text-slate-500">{schedule} · crontab del server</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${toneCls}`}>
            {statusBadge.text}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy !== null}
            onClick={toggle}
            className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
              enabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-slate-300 bg-slate-100 text-slate-600"
            }`}
          >
            {enabled ? "Attivo" : "In pausa"}
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-600">{lastRunLabel}</div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" disabled={busy !== null} onClick={loadPreview}>
          {busy === "preview" ? "Anteprima…" : "Anteprima"}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null || !preview}
          title={preview ? undefined : "Genera prima l'anteprima"}
          onClick={() => setConfirming(true)}
        >
          Esegui ora
        </button>
      </div>

      {msg ? (
        <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
          {msg.text}{" "}
          {msg.runId ? (
            <Link href={`/log/cron/${msg.runId}`} className="underline">
              Dettaglio esecuzione
            </Link>
          ) : null}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-2 rounded-lg border border-line-soft">
          <p className="px-3 pt-3 text-sm text-slate-600">
            Anteprima delle {new Date(preview.previewedAt).toLocaleTimeString("it-IT")}:{" "}
            {charges
              ? `${preview.wouldCharge ?? 0} addebiti per ${formatEur(total)}`
              : `${preview.wouldSend ?? 0} email da inviare`}
            , {preview.skipped} saltati.
          </p>
          <CronDetailsTable details={preview.details} />
        </div>
      ) : null}

      {confirming && preview ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {!enabled ? <p>Il cron è in pausa: l&apos;esecuzione manuale procede comunque.</p> : null}
          {charges ? (
            <>
              <p>
                Verranno tentati <strong>{preview.wouldCharge ?? 0} addebiti</strong> per un totale di{" "}
                <strong>{formatEur(total)}</strong>. Scrivi <strong>{AUTOCHARGE_CONFIRM_WORD}</strong> per confermare.
              </p>
              <input
                className="field max-w-xs"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                aria-label="Parola di conferma"
                autoComplete="off"
              />
            </>
          ) : (
            <p>Confermi l&apos;esecuzione immediata di &quot;{label}&quot;? Verranno inviate email reali.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || (charges && word.trim() !== AUTOCHARGE_CONFIRM_WORD)}
              onClick={run}
            >
              {busy === "run" ? "Esecuzione…" : "Conferma esecuzione"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>
              Annulla
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
