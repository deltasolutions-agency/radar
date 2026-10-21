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
import { ResendButton } from "./resend-button";

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
      client: { select: { id: true, name: true, ragioneSociale: true } },
      subscription: { select: { id: true } },
    },
  });
  if (!log) notFound();

  const clientName = log.client
    ? log.client.ragioneSociale?.trim()
      ? log.client.ragioneSociale
      : log.client.name
    : null;

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
          <ResendButton id={log.id} recipient={log.to[0] ?? ""} />
        </div>
      </section>

      <EmailPreview html={log.html} text={log.text} />
    </div>
  );
}
