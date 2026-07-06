import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import {
  CLIENT_DATA_FIELD_LABELS,
  type ClientDataFieldKey,
} from "@/lib/client-data";
import { LogTable, type LogRow, type LogChange } from "./log-table";

export const dynamic = "force-dynamic";

/** Converte il JSON `changes` ({ campo: { from, to } }) in righe leggibili. */
function readableChanges(changes: unknown): LogChange[] {
  if (!changes || typeof changes !== "object") return [];
  const out: LogChange[] = [];
  for (const [key, val] of Object.entries(changes as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const { from, to } = val as { from?: unknown; to?: unknown };
    out.push({
      label:
        CLIENT_DATA_FIELD_LABELS[key as ClientDataFieldKey] ?? key,
      from: typeof from === "string" ? from : "",
      to: typeof to === "string" ? to : "",
    });
  }
  return out;
}

export default async function LogPage() {
  const logs = await prisma.clientDataChangeLog.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true, ragioneSociale: true } },
    },
  });

  const rows: LogRow[] = logs.map((log) => ({
    id: log.id,
    createdAt: formatDateTime(log.createdAt),
    clientId: log.clientId,
    clientName: log.client.ragioneSociale?.trim()
      ? log.client.ragioneSociale
      : log.client.name,
    changes: readableChanges(log.changes),
    ipAddress: log.ipAddress,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Modifiche ai dati di fatturazione effettuate dai clienti
        </p>
      </div>

      <LogTable rows={rows} />
    </div>
  );
}
