import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import {
  CLIENT_DATA_FIELD_LABELS,
  type ClientDataFieldKey,
} from "@/lib/client-data";
import { LogTable, type LogRow, type LogChange } from "./log-table";
import { EmailLogTab } from "./email-tab";
import { CronStatus } from "./cron-status";
import { TestEmailButton } from "./test-email-button";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";

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

type LogSearchParams = Record<string, string | undefined>;

export default async function LogPage({
  searchParams,
}: {
  searchParams: LogSearchParams;
}) {
  const tab = searchParams.tab === "email" ? "email" : "dati";
  const admin = await getAdminSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tab === "email"
            ? "Tutte le email inviate da Radar, con contenuto completo"
            : "Modifiche ai dati di fatturazione effettuate dai clienti"}
        </p>
      </div>

      <nav className="flex gap-1 border-b border-line text-sm">
        <TabLink href="/log" active={tab === "dati"}>
          Modifiche dati
        </TabLink>
        {admin ? (
          <TabLink href="/log?tab=email" active={tab === "email"}>
            Email
          </TabLink>
        ) : null}
      </nav>

      {tab === "email" ? (
        admin ? (
          <EmailLogTab
            searchParams={searchParams}
            header={
              <>
                <CronStatus />
                <TestEmailButton />
              </>
            }
          />
        ) : (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sezione riservata agli amministratori.
          </p>
        )
      ) : (
        <DataChangesTab />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 font-medium transition ${
        active
          ? "border-brand text-ink"
          : "border-transparent text-slate-500 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

async function DataChangesTab() {
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

  return <LogTable rows={rows} />;
}
