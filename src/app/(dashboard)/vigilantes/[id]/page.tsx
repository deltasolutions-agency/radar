import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { clientDisplayName } from "@/lib/cron/common";
import { buildConnectionKey, secretFingerprint } from "@/lib/vigilantes/protocol";
import {
  ALERT_KIND_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  SEVERITY_STYLES,
  SITE_HEALTH,
  STICKY_ALERT_KINDS,
  VIGILANTES_ALERT_RECIPIENT,
  siteHealth,
  type AlertKindValue,
  type AlertSeverityValue,
} from "@/lib/vigilantes/meta";
import {
  AckButton,
  CheckNowButton,
  ConnectionKeyPanel,
  DeepScanToggle,
  DeleteSiteButton,
  EnabledToggle,
  SiteFormButton,
} from "../site-actions";
import { BulkAckButton, IgnoreFileButton, RecipientsManager, SiteMenu, TestEmailButton } from "../site-panels";

export const dynamic = "force-dynamic";

const TABS = {
  panoramica: "Panoramica",
  aggiornamenti: "Aggiornamenti",
  sicurezza: "Sicurezza",
  componenti: "Componenti",
  impostazioni: "Notifiche e impostazioni",
} as const;
type Tab = keyof typeof TABS;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const yesNo = (v: unknown): string => (v === true ? "Sì" : v === false ? "No" : "—");
const unixDate = (v: unknown): string =>
  typeof v === "number" && v > 0 ? formatRomeDateTime(new Date(v * 1000)) : "mai";
const isUpdate = (kind: string) => kind.endsWith("_UPDATE");
const MODE_LABEL = { ALL: "tutto", CRITICAL: "solo critici", DIGEST: "solo riepilogo" } as const;

// ── Pezzi di UI ────────────────────────────────────────────────────────────

function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "text-ink";
  return (
    <div className="card px-4 py-4">
      <p className="mono-label">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[severity as AlertSeverityValue]}`}>
      {SEVERITY_LABELS[severity as AlertSeverityValue]}
    </span>
  );
}

/** Elenco file ({ list, total }) con "È innocuo, ignora" per ciascuno. */
function FileList({
  title,
  value,
  siteId,
  ignorable,
  prefix = "",
}: {
  title: string;
  value: unknown;
  siteId: string;
  ignorable: boolean;
  prefix?: string;
}) {
  const v = obj(value);
  const list = arr(v.list).map(String);
  const total = typeof v.total === "number" ? v.total : list.length;
  if (total === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-slate-600">
        {title} ({total})
      </p>
      <ul className="mt-1 space-y-1">
        {list.map((f) => (
          <li key={f} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-canvas px-2.5 py-1.5">
            <span className="break-all font-mono text-[12px] text-ink">{prefix + f}</span>
            {ignorable ? <IgnoreFileButton siteId={siteId} path={prefix + f} /> : null}
          </li>
        ))}
        {total > list.length ? <li className="text-xs text-slate-500">… e altri {total - list.length}</li> : null}
      </ul>
    </div>
  );
}

function AlertDetails({ kind, details, siteId }: { kind: string; details: unknown; siteId: string }) {
  const d = obj(details);
  if (kind === "CORE_INTEGRITY") {
    return (
      <>
        <FileList title="Estranei (non presenti nell'originale)" value={d.unknown} siteId={siteId} ignorable />
        <FileList title="Modificati" value={d.modified} siteId={siteId} ignorable />
        <FileList title="Mancanti" value={d.missing} siteId={siteId} ignorable={false} />
      </>
    );
  }
  if (kind === "UPLOADS_PHP") return <FileList title="File" value={d.files} siteId={siteId} ignorable />;
  if (kind === "PLUGIN_INTEGRITY") {
    return (
      <div className="mt-2 space-y-2">
        {arr(d.plugins).map((p) => {
          const pp = obj(p);
          const prefix = `wp-content/plugins/${String(pp.slug).split("/")[0]}/`;
          return (
            <div key={String(pp.slug)} className="rounded-md border border-line-soft p-2">
              <p className="text-xs font-medium">
                {txt(pp.name ?? pp.slug)} <span className="font-mono text-slate-500">{txt(pp.version)}</span>
              </p>
              <FileList title="Modificati" value={pp.modified} siteId={siteId} ignorable prefix={prefix} />
              <FileList title="Estranei" value={pp.unknown} siteId={siteId} ignorable prefix={prefix} />
            </div>
          );
        })}
      </div>
    );
  }
  if (kind === "MALWARE_SUSPECT") {
    const findings = arr(d.findings).map(obj);
    return (
      <div className="mt-2 space-y-1.5">
        {findings.map((f, i) => (
          <div key={i} className="rounded-md border border-line-soft p-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="break-all font-mono text-[12px] text-ink">
                {txt(f.file)}
                {typeof f.line === "number" ? `:${f.line}` : ""}
              </p>
              <IgnoreFileButton siteId={siteId} path={String(f.file)} />
            </div>
            <p className={`text-xs ${f.severity === "high" ? "text-red-700" : "text-amber-800"}`}>
              {txt(f.label ?? f.rule)} <span className="font-mono text-slate-400">({txt(f.rule)})</span>
            </p>
            {f.excerpt ? (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-canvas p-1.5 font-mono text-[11px] text-slate-600">
                {String(f.excerpt)}
              </pre>
            ) : null}
          </div>
        ))}
        {typeof d.total === "number" && d.total > findings.length ? (
          <p className="text-xs text-slate-500">… e altre {d.total - findings.length} segnalazioni</p>
        ) : null}
      </div>
    );
  }
  return null;
}

type AlertRow = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  details: unknown;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  notifiedAt: Date | null;
};

function AlertItem({ a, siteId }: { a: AlertRow; siteId: string }) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-t border-line-soft px-5 py-4 first:border-0 ${
        a.acknowledgedAt ? "opacity-60" : a.severity === "CRITICAL" ? "bg-red-50/40" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={a.severity} />
          <span className="mono-label">{ALERT_KIND_LABELS[a.kind as AlertKindValue] ?? a.kind}</span>
        </div>
        <p className="mt-1 text-sm font-semibold text-ink">{a.title}</p>
        <p className="font-mono text-[11px] text-slate-500">
          dal {formatRomeDateTime(a.openedAt)}
          {a.notifiedAt ? " · allarme inviato" : ""}
          {a.acknowledgedAt ? ` · visto da ${a.acknowledgedBy ?? "?"}` : ""}
        </p>
        <AlertDetails kind={a.kind} details={a.details} siteId={siteId} />
      </div>
      <AckButton alertId={a.id} acknowledged={!!a.acknowledgedAt} sticky={STICKY_ALERT_KINDS.includes(a.kind as AlertKindValue)} />
    </div>
  );
}

type CheckState = "ok" | "bad" | "info" | "off";

function Check({ state, label, value }: { state: CheckState; label: string; value: string }) {
  const [icon, style] = {
    ok: ["✓", "bg-emerald-50 text-emerald-700"],
    bad: ["!", "bg-red-50 text-red-700"],
    info: ["i", "bg-blue-50 text-blue-700"],
    off: ["–", "bg-slate-100 text-slate-500"],
  }[state];
  return (
    <div className="flex items-start gap-3 border-t border-line-soft py-2.5 first:border-0">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${style}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-slate-500">{value}</p>
      </div>
    </div>
  );
}

// ── Pagina ─────────────────────────────────────────────────────────────────

export default async function VigilantesSitePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | undefined>;
}) {
  if (!(await getAdminSession())) {
    return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>;
  }
  const tab: Tab = searchParams.tab && searchParams.tab in TABS ? (searchParams.tab as Tab) : "panoramica";
  const site = await prisma.wpSite.findUnique({
    where: { id: params.id },
    include: {
      client: { select: { id: true, name: true, ragioneSociale: true } },
      components: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      alerts: { orderBy: [{ openedAt: "desc" }], take: 200 },
      recipients: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!site) notFound();
  const clients = await prisma.client.findMany({
    where: { status: { not: "CESSATO" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, ragioneSociale: true },
  });

  const open = site.alerts.filter((a) => !a.resolvedAt);
  const resolved = site.alerts
    .filter((a) => a.resolvedAt)
    .sort((x, y) => (y.resolvedAt?.getTime() ?? 0) - (x.resolvedAt?.getTime() ?? 0))
    .slice(0, 10);
  const security = open
    .filter((a) => !isUpdate(a.kind))
    .sort((a, b) => SEVERITY_RANK[b.severity as AlertSeverityValue] - SEVERITY_RANK[a.severity as AlertSeverityValue]);
  const updateAlerts = open.filter((a) => isUpdate(a.kind));
  const components = site.components;
  const pending = components.filter((c) => c.newVersion);
  const pendingActive = pending.filter((c) => c.type === "CORE" || c.active);
  const pendingInactive = pending.filter((c) => c.type !== "CORE" && !c.active);
  const alertFor = (type: string, slug: string) =>
    updateAlerts.find((a) => a.kind === `${type}_UPDATE` && (type === "CORE" || obj(a.details).slug === slug));
  const health = SITE_HEALTH[siteHealth(site, open)];
  const securityToDo = security.filter((a) => !a.acknowledgedAt);
  const critical = securityToDo.filter((a) => a.severity === "CRITICAL");

  const report = obj(site.report);
  const env = obj(report.env);
  const sec = obj(report.security);
  const integrity = obj(sec.integrity);
  const uploads = obj(sec.uploads_php);
  const malware = obj(sec.malware);
  const pluginIntegrity = obj(sec.plugin_integrity);
  const agent = obj(report.agent);
  const admins = arr(report.admins).map(obj);
  const lastNotified = site.alerts.reduce<Date | null>((m, a) => (a.notifiedAt && (!m || a.notifiedAt > m) ? a.notifiedAt : m), null);
  const connectionKey = buildConnectionKey(process.env.APP_URL ?? "", site.id, site.secret);
  const href = (t: Tab) => (t === "panoramica" ? `/vigilantes/${site.id}` : `/vigilantes/${site.id}?tab=${t}`);
  const coreComp = components.find((c) => c.type === "CORE");

  const checks: { state: CheckState; label: string; value: string }[] = [
    {
      state: arr(uploads.files).length > 0 ? "bad" : uploads.checked_at ? "ok" : "off",
      label: "PHP in uploads",
      value: uploads.checked_at ? `${arr(uploads.files).length} file · ${unixDate(uploads.checked_at)}` : "non ancora verificato",
    },
    {
      state: integrity.ok === false ? "bad" : integrity.ok === true ? "ok" : "off",
      label: "File del core",
      value:
        integrity.ok === true
          ? "identici all'originale"
          : integrity.ok === false
            ? "diversi dall'originale"
            : txt(integrity.error ?? "non ancora verificato"),
    },
    site.deepScan
      ? {
          state: arr(malware.findings).length > 0 ? "bad" : malware.checked_at ? "ok" : "off",
          label: "Codice sospetto",
          value: malware.checked_at
            ? `${arr(malware.findings).length} segnalazioni su ${txt(malware.scanned)} file · ${unixDate(malware.checked_at)}`
            : malware.complete === false
              ? "scansione in corso"
              : "in attesa della prima scansione",
        }
      : { state: "off", label: "Codice sospetto", value: "scansione approfondita spenta" },
    site.deepScan
      ? {
          state: arr(pluginIntegrity.plugins).length > 0 ? "bad" : pluginIntegrity.checked_at ? "ok" : "off",
          label: "Plugin wordpress.org",
          value: pluginIntegrity.checked_at
            ? `${txt(pluginIntegrity.checked)} verificati · ${arr(pluginIntegrity.plugins).length} alterati · ${txt(pluginIntegrity.skipped)} non verificabili`
            : "in attesa della prima scansione",
        }
      : { state: "off", label: "Plugin wordpress.org", value: "scansione approfondita spenta" },
    {
      state: agent.loader === true ? "ok" : agent.loader === false ? "bad" : "off",
      label: "Blocco disattivazione",
      value: agent.loader === true ? "attivo (loader in mu-plugins)" : agent.loader === false ? "assente" : "plugin precedente alla 1.0.1",
    },
    { state: "info", label: "Amministratori", value: admins.length ? admins.map((a) => txt(a.login)).join(", ") : "—" },
    {
      state: env.disallow_file_edit === true ? "ok" : "info",
      label: "Modifica file da admin",
      value: env.disallow_file_edit === true ? "disabilitata" : "consentita · consiglio: disattivarla",
    },
  ];

  const checksCard = (
    <Card title="Controlli di sicurezza">
      <div className="px-5 py-2">
        {checks.map((c) => (
          <Check key={c.label} {...c} />
        ))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Intestazione */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <Link href="/vigilantes" className="text-sm text-slate-500 hover:underline">
            ← Vigilantes
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${health.style}`}>
              {securityToDo.length > 0 && site.enabled
                ? `${securityToDo.length} ${securityToDo.length === 1 ? "problema" : "problemi"} da verificare`
                : health.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            <a href={site.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-brand hover:underline">
              {site.url} ↗
            </a>
            {site.client ? (
              <span>
                Cliente:{" "}
                <Link href={`/clienti/${site.client.id}`} className="text-ink underline">
                  {clientDisplayName(site.client)}
                </Link>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <SiteFormButton
            clients={clients.map((c) => ({ id: c.id, label: clientDisplayName(c) }))}
            site={{ id: site.id, name: site.name, url: site.url, clientId: site.clientId, notes: site.notes }}
          />
          <SiteMenu siteId={site.id} enabled={site.enabled} label={site.name} />
          <CheckNowButton siteId={site.id} />
        </div>
      </div>

      {!site.lastReportAt ? (
        <section className="card border-brand/30 p-6">
          <h2 className="mono-label mb-3">Collega il sito</h2>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>
              <a href="/api/vigilantes/plugin/download" className="text-brand hover:underline">
                Scarica il plugin
              </a>{" "}
              e installalo dal pannello WordPress (Plugin → Aggiungi nuovo → Carica plugin).
            </li>
            <li>Attivalo e apri Impostazioni → Radar Vigilantes.</li>
            <li>Incolla la chiave qui sotto e salva: il plugin invia subito il primo report.</li>
          </ol>
          <ConnectionKeyPanel siteId={site.id} connectionKey={connectionKey} fingerprint={secretFingerprint(site.secret)} />
        </section>
      ) : null}

      {/* Riquadri */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Stato"
          value={
            !site.enabled
              ? "In pausa"
              : critical.length
                ? `${critical.length} critic${critical.length === 1 ? "o" : "i"}`
                : securityToDo.length
                  ? `${securityToDo.length} da verificare`
                  : "Nessun problema"
          }
          sub={securityToDo[0] ? (ALERT_KIND_LABELS[securityToDo[0].kind as AlertKindValue] ?? "") : "sicurezza ok"}
          tone={critical.length ? "bad" : securityToDo.length ? "warn" : "ok"}
        />
        <Tile
          label="Aggiornamenti"
          value={pending.length ? `${pending.length} disponibili` : "Tutto aggiornato"}
          sub={pending.length ? `${pendingActive.length} su componenti attivi` : `${components.length} componenti`}
          tone={pendingActive.length ? "warn" : "ok"}
        />
        <Tile
          label="WordPress"
          value={site.wpVersion ?? "—"}
          sub={`PHP ${site.phpVersion ?? "—"}${coreComp?.newVersion ? ` · disponibile ${coreComp.newVersion}` : ""}`}
          tone={coreComp?.newVersion ? "warn" : "ok"}
        />
        <Tile
          label="Ultimo controllo"
          value={site.lastCheckAt ? formatRomeDateTime(site.lastCheckAt) : site.lastReportAt ? formatRomeDateTime(site.lastReportAt) : "mai"}
          sub={`${site.lastCheckOk === false ? "fallito" : "ok"} · plugin ${site.pluginVersion ?? "—"} · prossimo alle 7:30`}
          tone={site.lastCheckOk === false ? "bad" : "ok"}
        />
      </div>

      {site.lastCheckOk === false && site.lastCheckError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Ultimo controllo fallito ({site.consecutiveFailures} di fila): {site.lastCheckError}
        </p>
      ) : null}

      {/* Schede */}
      <nav aria-label="Sezioni del sito" className="flex gap-1 overflow-x-auto border-b border-line text-sm">
        {(Object.keys(TABS) as Tab[]).map((t) => {
          const count =
            t === "aggiornamenti" ? pending.length : t === "sicurezza" ? security.length : t === "componenti" ? components.length : 0;
          const badge =
            t === "aggiornamenti" && count ? "bg-amber-50 text-amber-800" : t === "sicurezza" && count ? "bg-red-50 text-red-700" : "text-slate-500";
          return (
            <Link
              key={t}
              href={href(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 font-medium ${
                tab === t ? "border-brand text-ink" : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              {TABS[t]}
              {count ? <span className={`rounded-full px-1.5 font-mono text-[11px] font-bold ${badge}`}>{count}</span> : null}
            </Link>
          );
        })}
      </nav>

      {tab === "panoramica" ? (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-4">
            <Card title="Da fare adesso" action={<span className="font-mono text-xs text-slate-500">in ordine di urgenza</span>}>
              {securityToDo.length === 0 && pendingActive.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Niente da fare: il sito è aggiornato e senza segnalazioni.</p>
              ) : null}
              {securityToDo.map((a) => (
                <AlertItem key={a.id} a={a} siteId={site.id} />
              ))}
              {pendingActive.length > 0 ? (
                <div className="border-t border-line-soft px-5 py-4 first:border-0">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {pendingActive.length} aggiornament{pendingActive.length === 1 ? "o" : "i"} su componenti attivi
                    </p>
                    <Link href={href("aggiornamenti")} className="text-sm font-medium text-brand hover:underline">
                      Vedi tutti ({pending.length}) →
                    </Link>
                  </div>
                  <div className="mt-2">
                    {pendingActive.slice(0, 6).map((c) => (
                      <div key={c.id} className="flex items-center gap-3 border-t border-line-soft py-2 text-sm">
                        <span className="min-w-0 flex-1 font-medium">
                          {c.name}
                          {c.type === "THEME" ? <span className="text-xs font-normal text-slate-500"> (tema)</span> : null}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {c.version ?? "?"} → <b className="text-amber-800">{c.newVersion}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                  {pendingInactive.length > 0 ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Altri {pendingInactive.length} su componenti <b>non attivi</b>: meglio eliminarli che aggiornarli.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>

            <Card title="Attività recente">
              {resolved.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Ancora nessuna attività.</p> : null}
              <div className="px-5 pb-2">
                {resolved.map((a) => (
                  <div key={a.id} className="flex items-baseline gap-3 border-t border-line-soft py-2.5 text-sm first:border-0">
                    <span className="w-32 shrink-0 font-mono text-xs text-slate-500">{a.resolvedAt ? formatRomeDateTime(a.resolvedAt) : ""}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span>Risolto: {a.title}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            {checksCard}
            <Card
              title="Chi riceve gli alert"
              action={
                <Link href={href("impostazioni")} className="text-sm font-medium text-brand hover:underline">
                  Gestisci
                </Link>
              }
            >
              <div className="space-y-2 px-5 py-4 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="break-all font-mono text-[13px]">{VIGILANTES_ALERT_RECIPIENT}</span>
                  <span className="shrink-0 text-slate-500">tutto</span>
                </div>
                {site.recipients.map((r) => (
                  <div key={r.id} className="flex justify-between gap-2">
                    <span className="break-all font-mono text-[13px]">{r.email}</span>
                    <span className="shrink-0 text-slate-500">{MODE_LABEL[r.mode]}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Ambiente">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-5 py-4 text-sm">
                <dt className="text-slate-500">PHP</dt>
                <dd>{txt(env.php ?? site.phpVersion)}</dd>
                <dt className="text-slate-500">Database</dt>
                <dd>{txt(env.mysql)}</dd>
                <dt className="text-slate-500">HTTPS</dt>
                <dd>{yesNo(env.https)}</dd>
                <dt className="text-slate-500">Auto-update core</dt>
                <dd>{txt(env.auto_update_core)}</dd>
                <dt className="text-slate-500">Errori visibili</dt>
                <dd className={env.debug_display === true ? "font-medium text-red-700" : ""}>{yesNo(env.debug_display)}</dd>
                <dt className="text-slate-500">WP-Cron disattivato</dt>
                <dd>{yesNo(env.wp_cron_disabled)}</dd>
              </dl>
            </Card>
          </aside>
        </div>
      ) : null}

      {tab === "aggiornamenti" ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Aggiorna dal pannello WordPress: dopo ogni aggiornamento il plugin avvisa Radar e la riga sparisce da sola.{" "}
            <a href={`${site.url}/wp-admin/update-core.php`} target="_blank" rel="noreferrer" className="font-semibold underline">
              Apri wp-admin ↗
            </a>
          </p>
          <Card title={`Su componenti attivi (${pendingActive.length})`}>
            {pendingActive.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Tutti i componenti attivi sono aggiornati.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="mono-label text-left">
                      <th className="px-5 py-2.5 font-medium">Componente</th>
                      <th className="px-3 py-2.5 font-medium">Versione</th>
                      <th className="px-3 py-2.5 font-medium">In attesa da</th>
                      <th className="px-3 py-2.5 font-medium">Auto-update</th>
                      <th className="px-5 py-2.5">
                        <span className="sr-only">Azioni</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingActive.map((c) => {
                      const al = alertFor(c.type, c.slug);
                      return (
                        <tr key={c.id} className={`border-t border-line-soft ${al?.acknowledgedAt ? "opacity-60" : ""}`}>
                          <td className="px-5 py-3">
                            <p className="font-medium">{c.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {c.type === "CORE" ? "core" : c.type === "THEME" ? "tema attivo" : "plugin"}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                            {c.version ?? "?"} → <b className="text-amber-800">{c.newVersion}</b>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600">{c.updateSince ? formatRomeDateTime(c.updateSince) : "—"}</td>
                          <td className="px-3 py-3 text-slate-600">{c.autoUpdate ? "sì" : "no"}</td>
                          <td className="px-5 py-3 text-right">
                            {al ? <AckButton alertId={al.id} acknowledged={!!al.acknowledgedAt} sticky={false} /> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card
            title={`Su componenti non attivi (${pendingInactive.length})`}
            action={
              <BulkAckButton
                label="Segna tutti come visti"
                alertIds={pendingInactive
                  .map((c) => alertFor(c.type, c.slug))
                  .filter((a): a is NonNullable<typeof a> => !!a && !a.acknowledgedAt)
                  .map((a) => a.id)}
              />
            }
          >
            <p className="px-5 pt-3 text-sm text-slate-600">Non servono al sito ma restano attaccabili: conviene eliminarli invece di aggiornarli.</p>
            <div className="px-5 pb-3">
              {pendingInactive.length === 0 ? <p className="py-3 text-sm text-slate-500">Nessuno.</p> : null}
              {pendingInactive.map((c) => {
                const al = alertFor(c.type, c.slug);
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center gap-3 border-t border-line-soft py-2.5 text-sm first:border-0 ${al?.acknowledgedAt ? "opacity-60" : ""}`}
                  >
                    <span className="min-w-[12rem] flex-1 font-medium">
                      {c.name} <span className="font-mono text-[11px] font-normal text-slate-500">{c.type === "THEME" ? "tema" : "plugin"}</span>
                    </span>
                    <span className="font-mono text-xs text-slate-600">
                      {c.version ?? "?"} → {c.newVersion}
                    </span>
                    <span className="w-32 text-xs text-slate-500">consiglio: elimina</span>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className="text-xs text-slate-500">
            &quot;Segna come visto&quot; toglie la voce dal riepilogo giornaliero; torna se esce una versione più nuova.
          </p>
        </div>
      ) : null}

      {tab === "sicurezza" ? (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-4">
            <Card title={`Segnalazioni aperte (${security.length})`}>
              {security.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Nessuna segnalazione di sicurezza aperta.</p> : null}
              {security.map((a) => (
                <AlertItem key={a.id} a={a} siteId={site.id} />
              ))}
            </Card>
            {site.ignoredPaths.length > 0 ? (
              <Card title={`File segnati come innocui (${site.ignoredPaths.length})`}>
                <ul className="space-y-1 px-5 py-4">
                  {site.ignoredPaths.map((p) => (
                    <li key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-canvas px-2.5 py-1.5">
                      <span className="break-all font-mono text-[12px]">{p}</span>
                      <IgnoreFileButton siteId={site.id} path={p} undo />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <p className="text-xs text-slate-500">
              Le segnalazioni su codice e file sono euristiche: verifica ogni file prima di intervenire. &quot;È innocuo, ignora&quot; esclude quel
              percorso dagli alert di questo sito (se il file cambia, va riverificato a mano).
            </p>
          </div>
          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">{checksCard}</aside>
        </div>
      ) : null}

      {tab === "componenti" ? (
        <Card>
          {components.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nessun dato: in attesa del primo report.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="mono-label border-b border-line text-left">
                    <th className="px-5 py-2.5 font-medium">Nome</th>
                    <th className="px-3 py-2.5 font-medium">Tipo</th>
                    <th className="px-3 py-2.5 font-medium">Versione</th>
                    <th className="px-3 py-2.5 font-medium">Disponibile</th>
                    <th className="px-3 py-2.5 font-medium">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {[...components]
                    .sort((x, y) => Number(!!y.newVersion) - Number(!!x.newVersion))
                    .map((c) => (
                      <tr key={c.id} className="border-b border-line-soft last:border-0">
                        <td className="px-5 py-2.5">
                          <p className="font-medium">{c.name}</p>
                          {c.type !== "CORE" ? <p className="font-mono text-[11px] text-slate-400">{c.slug}</p> : null}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{c.type === "CORE" ? "Core" : c.type === "PLUGIN" ? "Plugin" : "Tema"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{c.version ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{c.newVersion ? <b className="text-amber-800">{c.newVersion}</b> : "—"}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {c.type === "CORE" ? "—" : c.active ? "Attivo" : "Disattivato"}
                          {c.autoUpdate ? <span className="ml-1 text-emerald-700">· auto-update</span> : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "impostazioni" ? (
        <div className="flex max-w-3xl flex-col gap-4">
          <Card>
            <div className="p-5">
              <h2 className="text-base font-semibold">Chi riceve gli alert di questo sito</h2>
              <p className="mb-4 mt-1 text-sm text-slate-600">
                Gli allarmi critici partono subito; il riepilogo arriva alle 7:30, solo se c&apos;è qualcosa di aperto. Gli indirizzi aggiunti qui
                ricevono solo ciò che riguarda {site.name}, senza link a Radar.
              </p>
              <RecipientsManager
                siteId={site.id}
                defaultEmail={VIGILANTES_ALERT_RECIPIENT}
                recipients={site.recipients.map((r) => ({ id: r.id, email: r.email, mode: r.mode }))}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
                <span className="text-sm text-slate-500">
                  {lastNotified ? `Ultimo allarme inviato: ${formatRomeDateTime(lastNotified)}.` : "Nessun allarme inviato finora."}
                </span>
                <TestEmailButton siteId={site.id} />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-start gap-4 p-5">
              <div className="min-w-[16rem] flex-1">
                <h2 className="text-base font-semibold">Scansione approfondita</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Cerca codice offuscato, backdoor e file sospetti e confronta i plugin di wordpress.org con gli originali. Gira sul sito una volta
                  al giorno, a tempo limitato.
                </p>
                {site.deepScan && malware.checked_at ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Ultima: {unixDate(malware.checked_at)} · {arr(malware.findings).length} segnalazioni su {txt(malware.scanned)} file
                  </p>
                ) : null}
              </div>
              <DeepScanToggle siteId={site.id} enabled={site.deepScan} />
            </div>
          </Card>

          <Card>
            <div className="p-5">
              <h2 className="mb-3 text-base font-semibold">Plugin e collegamento</h2>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="mono-label">Versione</p>
                  <p className="mt-1 font-medium">{site.pluginVersion ?? "—"}</p>
                </div>
                <div>
                  <p className="mono-label">Blocco disattivazione</p>
                  <p className={`mt-1 font-medium ${agent.loader === true ? "text-emerald-700" : agent.loader === false ? "text-red-700" : ""}`}>
                    {agent.loader === true ? "Attivo" : agent.loader === false ? "Assente" : "—"}
                  </p>
                </div>
                <div>
                  <p className="mono-label">Ultimo contatto</p>
                  <p className="mt-1 font-medium">{site.lastReportAt ? formatRomeDateTime(site.lastReportAt) : "mai"}</p>
                </div>
              </div>
              <ConnectionKeyPanel siteId={site.id} connectionKey={connectionKey} fingerprint={secretFingerprint(site.secret)} />
              <p className="mt-3 text-sm">
                <a href="/api/vigilantes/plugin/download" className="font-medium text-brand hover:underline">
                  Scarica il plugin (zip) ↓
                </a>
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <h2 className="text-base font-semibold">{site.enabled ? "Metti in pausa il monitoraggio" : "Monitoraggio in pausa"}</h2>
                <p className="mt-1 text-sm text-slate-600">Niente controlli né alert finché non lo riattivi. Utile durante lavori o migrazioni.</p>
              </div>
              <EnabledToggle siteId={site.id} enabled={site.enabled} />
            </div>
          </Card>

          <section className="card flex flex-wrap items-center justify-between gap-4 border-red-200 p-5">
            <div>
              <h2 className="text-base font-semibold text-red-700">Elimina il sito da Vigilantes</h2>
              <p className="mt-1 text-sm text-slate-600">Cancella componenti, alert e destinatari; il plugin sul sito non verrà più accettato.</p>
            </div>
            <DeleteSiteButton siteId={site.id} label={site.name} />
          </section>

          {site.notes ? (
            <Card title="Note">
              <p className="whitespace-pre-line px-5 py-4 text-sm">{site.notes}</p>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
