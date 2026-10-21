import { formatEur } from "@/lib/format";

// Tabella dei dettagli di un cron (anteprima o esecuzione registrata).
// Componente senza stato: usabile sia lato server sia dentro componenti client.

const OUTCOME: Record<string, { label: string; tone: "ok" | "bad" | "warn" | "muted" }> = {
  WOULD_SEND: { label: "Da inviare", tone: "ok" },
  WOULD_CHARGE: { label: "Da addebitare", tone: "ok" },
  SENT: { label: "Inviata", tone: "ok" },
  CHARGED: { label: "Addebitata", tone: "ok" },
  SKIPPED: { label: "Già inviata", tone: "muted" },
  NOT_SENDABLE: { label: "Non inviabile", tone: "warn" },
  NO_EMAIL: { label: "Cliente senza email", tone: "warn" },
  BACKLOG: { label: "Arretrato", tone: "warn" },
  EXCLUDED: { label: "Esclusa", tone: "warn" },
  DISABLE_EXPIRED: { label: "Da disattivare", tone: "warn" },
  ALREADY_ATTEMPTED_TODAY: { label: "Già tentata oggi", tone: "muted" },
  SKIPPED_AUTOCHARGE_TODAY: { label: "Coperta da addebito", tone: "muted" },
  RECONCILE: { label: "Da riconciliare", tone: "bad" },
  FAILED: { label: "Fallita", tone: "bad" },
  ERROR: { label: "Errore", tone: "bad" },
};

const TONE = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bad: "border-red-200 bg-red-50 text-red-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  muted: "border-slate-200 bg-slate-100 text-slate-600",
};

type Detail = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function amountOf(d: Detail): string {
  const cents = d.totalCents ?? d.grossCents;
  return typeof cents === "number" ? formatEur(cents) : "";
}

export function CronDetailsTable({ details }: { details: Detail[] }) {
  if (details.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-slate-500">Nessuna voce.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left mono-label">
            <th className="px-3 py-2 font-medium">Esito</th>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Servizi</th>
            <th className="px-3 py-2 font-medium">Scadenza</th>
            <th className="px-3 py-2 font-medium">Dettaglio</th>
            <th className="px-3 py-2 font-medium text-right">Importo</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d, i) => {
            const o = OUTCOME[str(d.outcome)] ?? { label: str(d.outcome), tone: "muted" as const };
            const extra = [str(d.note), d.recipient ? `→ ${str(d.recipient)}` : "", str(d.error)]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={i} className="border-b border-line-soft align-top last:border-0">
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[o.tone]}`}>
                    {o.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink">{str(d.client) || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{str(d.services) || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                  {str(d.dueDate) || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{extra || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{amountOf(d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
