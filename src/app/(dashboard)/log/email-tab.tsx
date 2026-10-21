import Link from "next/link";
import type {
  EmailLogStatus,
  EmailLogType,
  EmailTrigger,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EmailStatusBadge } from "@/components/badges";
import {
  EMAIL_LOG_STATUS_LABELS,
  EMAIL_LOG_TYPE_LABELS,
  EMAIL_TRIGGER_LABELS,
  formatRomeDateTime,
} from "@/lib/email-log-labels";

const PAGE_SIZE = 50;

const TYPES = Object.keys(EMAIL_LOG_TYPE_LABELS) as EmailLogType[];
const STATUSES = Object.keys(EMAIL_LOG_STATUS_LABELS) as EmailLogStatus[];
const TRIGGERS = Object.keys(EMAIL_TRIGGER_LABELS) as EmailTrigger[];

type Filters = {
  type?: EmailLogType;
  status?: EmailLogStatus;
  trigger?: EmailTrigger;
  clientId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  q?: string;
  page: number;
};

function parseFilters(sp: Record<string, string | undefined>): Filters {
  const pick = <T extends string>(v: string | undefined, allowed: T[]) =>
    v && (allowed as string[]).includes(v) ? (v as T) : undefined;
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  return {
    type: pick(sp.type, TYPES),
    status: pick(sp.status, STATUSES),
    trigger: pick(sp.trigger, TRIGGERS),
    clientId: sp.clientId?.trim() || undefined,
    from: date(sp.from),
    to: date(sp.to),
    q: sp.q?.trim() || undefined,
    page,
  };
}

/** Where Prisma dai filtri. La ricerca destinatario è parziale (ILIKE su "to"). */
async function buildWhere(f: Filters): Promise<Prisma.EmailLogWhereInput> {
  const where: Prisma.EmailLogWhereInput = {};
  if (f.type) where.type = f.type;
  if (f.status) where.status = f.status;
  if (f.trigger) where.trigger = f.trigger;
  if (f.clientId) where.clientId = f.clientId;
  if (f.from || f.to) {
    // Giorni interi nel fuso del server (Europe/Berlin = Europe/Rome).
    where.createdAt = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00`) } : {}),
      ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999`) } : {}),
    };
  }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const byRecipient = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM email_logs
      WHERE array_to_string("to", ',') ILIKE ${like}
      ORDER BY "createdAt" DESC
      LIMIT 5000`;
    where.OR = [
      { subject: { contains: f.q, mode: "insensitive" } },
      { id: { in: byRecipient.map((r) => r.id) } },
    ];
  }
  return where;
}

function queryString(f: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...f, ...overrides };
  const params = new URLSearchParams({ tab: "email" });
  for (const [k, v] of Object.entries(merged)) {
    if (v == null || v === "" || (k === "page" && v === 1)) continue;
    params.set(k, String(v));
  }
  return `/log?${params.toString()}`;
}

/**
 * Tab "Email" della sezione Log (solo admin): elenco filtrabile e paginato lato
 * server degli EmailLog, con stato dei cron e invio email di test.
 */
export async function EmailLogTab({
  searchParams,
  header,
}: {
  searchParams: Record<string, string | undefined>;
  /** Contenuto opzionale sopra i filtri (stato cron, azioni). */
  header?: React.ReactNode;
}) {
  const f = parseFilters(searchParams);
  const where = await buildWhere(f);

  const [total, logs, clients] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        type: true,
        status: true,
        trigger: true,
        to: true,
        subject: true,
        clientId: true,
        client: { select: { name: true, ragioneSociale: true } },
      },
    }),
    prisma.client.findMany({
      select: { id: true, name: true, ragioneSociale: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clientLabel = (c: { name: string; ragioneSociale: string | null }) =>
    c.ragioneSociale?.trim() ? c.ragioneSociale : c.name;

  return (
    <div className="space-y-4">
      {header}

      <form method="get" action="/log" className="card grid gap-3 p-4 sm:grid-cols-4">
        <input type="hidden" name="tab" value="email" />
        <select name="type" defaultValue={f.type ?? ""} className="field" aria-label="Tipo">
          <option value="">Tutti i tipi</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {EMAIL_LOG_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="field" aria-label="Stato">
          <option value="">Tutti gli stati</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {EMAIL_LOG_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="trigger" defaultValue={f.trigger ?? ""} className="field" aria-label="Origine">
          <option value="">Tutte le origini</option>
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>
              {EMAIL_TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="clientId" defaultValue={f.clientId ?? ""} className="field" aria-label="Cliente">
          <option value="">Tutti i clienti</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {clientLabel(c)}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-500">
          Dal
          <input type="date" name="from" defaultValue={f.from ?? ""} className="field mt-1" />
        </label>
        <label className="text-xs text-slate-500">
          Al
          <input type="date" name="to" defaultValue={f.to ?? ""} className="field mt-1" />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Destinatario o oggetto
          <input
            type="search"
            name="q"
            defaultValue={f.q ?? ""}
            placeholder="es. rossi@ oppure Scadenza"
            className="field mt-1"
          />
        </label>
        <div className="flex gap-2 sm:col-span-4">
          <button type="submit" className="btn-primary">
            Filtra
          </button>
          <Link href="/log?tab=email" className="btn-ghost">
            Azzera
          </Link>
        </div>
      </form>

      <p className="text-sm text-slate-500">
        {total} email · pagina {f.page} di {pages}
      </p>

      <div className="card overflow-hidden">
        {logs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Nessuna email corrisponde ai filtri.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-4 py-3 font-medium">Data/ora</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Stato</th>
                  <th className="px-4 py-3 font-medium">Destinatario</th>
                  <th className="px-4 py-3 font-medium">Oggetto</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Origine</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-line-soft align-top transition last:border-0 hover:bg-canvas"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                      <Link href={`/log/email/${l.id}`} className="hover:underline">
                        {formatRomeDateTime(l.createdAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{EMAIL_LOG_TYPE_LABELS[l.type]}</td>
                    <td className="px-4 py-3">
                      <EmailStatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.to.join(", ") || "—"}</td>
                    <td className="max-w-[22rem] px-4 py-3">
                      <Link
                        href={`/log/email/${l.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {l.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {l.clientId && l.client ? (
                        <Link href={`/clienti/${l.clientId}`} className="text-ink hover:underline">
                          {clientLabel(l.client)}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{EMAIL_TRIGGER_LABELS[l.trigger]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          {f.page > 1 ? (
            <Link href={queryString(f, { page: f.page - 1 })} className="btn-ghost">
              ← Precedenti
            </Link>
          ) : null}
          {f.page < pages ? (
            <Link href={queryString(f, { page: f.page + 1 })} className="btn-ghost">
              Successive →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
