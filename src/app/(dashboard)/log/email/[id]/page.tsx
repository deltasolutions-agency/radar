import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { EmailStatusBadge } from "@/components/badges";
import {
  EMAIL_LOG_TYPE_LABELS,
  EMAIL_TRIGGER_LABELS,
  formatRomeDateTime,
} from "@/lib/email-log-labels";
import { EmailPreview } from "./email-preview";
import { ResendDialog } from "./resend-dialog";

// Email indirizzate all'ADMIN: il reinvio propone sempre i destinatari originali
// (mai il cliente, anche se collegate a un cliente).
const ADMIN_TYPES = new Set([
  "ADMIN_ESCALATION",
  "ADMIN_SUMMARY",
  "AUTOCHARGE_FAILED",
  "DATA_CHANGE_NOTICE",
]);
const DAY_MS = 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

export default async function EmailLogDetailPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Sezione riservata agli amministratori.
      </p>
    );
  }

  const log = await prisma.emailLog.findUnique({
    where: { id: params.id },
    include: {
      client: {
        select: { id: true, name: true, ragioneSociale: true, email: true, pec: true },
      },
      subscription: { select: { id: true } },
      resentFrom: { select: { id: true, createdAt: true } },
      resends: {
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, to: true, status: true },
      },
    },
  });
  if (!log) notFound();

  const clientName = log.client
    ? log.client.ragioneSociale?.trim()
      ? log.client.ragioneSociale
      : log.client.name
    : null;

  // Destinatari proposti per il reinvio.
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const lower = (a: string) => a.trim().toLowerCase();
  const addressedToClient =
    !!log.client &&
    !ADMIN_TYPES.has(log.type) &&
    !log.to.some((t) => adminEmail && lower(t) === adminEmail);
  const currentEmail = addressedToClient ? log.client?.email?.trim() || null : null;
  const addressChanged =
    !!currentEmail && !log.to.some((t) => lower(t) === lower(currentEmail));
  const pec = addressedToClient ? log.client?.pec?.trim() || null : null;
  const canResend = log.status === "SENT" || log.status === "FAILED";

  const rows: [string, React.ReactNode][] = [
    ["Data/ora", <span key="d" className="font-mono">{formatRomeDateTime(log.createdAt)}</span>],
    ["Tipo", EMAIL_LOG_TYPE_LABELS[log.type]],
    ["Stato", <EmailStatusBadge key="s" status={log.status} />],
    ["Origine", EMAIL_TRIGGER_LABELS[log.trigger]],
    ["Mittente", log.from || "—"],
    ["Destinatari", log.to.join(", ") || "—"],
    ...(log.cc.length > 0 ? ([["Cc", log.cc.join(", ")]] as [string, React.ReactNode][]) : []),
    ...(log.bcc.length > 0 ? ([["Ccn", log.bcc.join(", ")]] as [string, React.ReactNode][]) : []),
    ...(log.replyTo ? ([["Rispondi a", log.replyTo]] as [string, React.ReactNode][]) : []),
    [
      "Cliente",
      log.client ? (
        <Link key="c" href={`/clienti/${log.client.id}`} className="hover:underline">
          {clientName}
        </Link>
      ) : (
        "—"
      ),
    ],
    [
      "Abbonamento",
      log.subscription ? (
        <Link key="a" href={`/abbonamenti/${log.subscription.id}`} className="hover:underline">
          Apri dettaglio
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Scadenza", log.dueDate ? log.dueDate.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" }) : "—"],
    ["Righe servizio", log.itemIds.length > 0 ? <span key="i" className="font-mono text-xs">{log.itemIds.join(", ")}</span> : "—"],
    ["Resend ID", log.resendId ? <span key="r" className="font-mono text-xs">{log.resendId}</span> : "—"],
    ["Chiave anti-doppio", log.dedupeKey ? <span key="k" className="font-mono text-xs">{log.dedupeKey}</span> : "—"],
    ...(log.attachmentNames.length > 0
      ? ([["Allegati (non reinviati)", log.attachmentNames.join(", ")]] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/log?tab=email" className="text-sm text-slate-500 hover:underline">
          ← Log email
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{log.subject}</h1>
        {log.resentFrom ? (
          <p className="mt-1 text-sm text-slate-500">
            Reinvio di:{" "}
            <Link href={`/log/email/${log.resentFrom.id}`} className="text-brand hover:underline">
              email del {formatRomeDateTime(log.resentFrom.createdAt)}
            </Link>
          </p>
        ) : null}
      </div>

      {log.errorMessage ? (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${
            log.status === "FAILED" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {log.errorMessage}
        </p>
      ) : null}

      <section className="card p-6">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="break-words text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 border-t border-line-soft pt-4">
          {canResend ? (
            <ResendDialog
              id={log.id}
              originalTo={log.to}
              currentAddresses={currentEmail ? [currentEmail] : []}
              addressChanged={addressChanged}
              suggestions={pec && pec !== currentEmail ? [pec] : []}
              defaultRecipients={currentEmail ? [currentEmail] : log.to}
              sentAtLabel={log.createdAt.toLocaleDateString("it-IT", {
                timeZone: "Europe/Rome",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
              isOld={Date.now() - log.createdAt.getTime() > 7 * DAY_MS}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Le email saltate (duplicati) non sono reinviabili.
            </p>
          )}
        </div>

        {log.resends.length > 0 ? (
          <div className="mt-6 border-t border-line-soft pt-4">
            <h2 className="mono-label">Reinvii</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {log.resends.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/log/email/${r.id}`} className="font-mono text-xs hover:underline">
                    {formatRomeDateTime(r.createdAt)}
                  </Link>
                  <span className="text-slate-600">{r.to.join(", ")}</span>
                  <EmailStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <EmailPreview html={log.html} text={log.text} />
    </div>
  );
}
