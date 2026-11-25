import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { formatRomeDateTime } from "@/lib/email-log-labels";
import { clientDisplayName } from "@/lib/cron/common";
import { buildConnectionKey, secretFingerprint } from "@/lib/vigilantes/protocol";
import {
  ALERT_KIND_LABELS,
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  SITE_HEALTH,
  STICKY_ALERT_KINDS,
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

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const yesNo = (v: unknown): string => (v === true ? "Sì" : v === false ? "No" : "—");
const unixDate = (v: unknown): string =>
  typeof v === "number" && v > 0 ? formatRomeDateTime(new Date(v * 1000)) : "mai";

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line-soft py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="mono-label w-44 shrink-0 sm:pt-0.5">{label}</dt>
      <dd className={`text-sm ${warn ? "font-medium text-red-700" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** Elenco file/percorsi dai dettagli di un alert ({ list, total }). */
function FileList({ title, value }: { title: string; value: unknown }) {
  const v = obj(value);
  const list = arr(v.list).map(String);
  const total = typeof v.total === "number" ? v.total : list.length;
  if (total === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-slate-600">
        {title} ({total})
      </p>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600">
        {list.map((f) => (
          <li key={f} className="break-all">
            {f}
          </li>
        ))}
        {total > list.length ? <li>… e altri {total - list.length}</li> : null}
      </ul>
    </div>
  );
}

function AlertDetails({ kind, details }: { kind: string; details: unknown }) {
  const d = obj(details);
  if (kind === "CORE_INTEGRITY") {
    return (
      <>
        <FileList title="Modificati" value={d.modified} />
        <FileList title="Estranei (non presenti nell'originale)" value={d.unknown} />
        <FileList title="Mancanti" value={d.missing} />
      </>
    );
  }
  if (kind === "UPLOADS_PHP") return <FileList title="File" value={d.files} />;
  if (kind === "PLUGIN_INTEGRITY") {
    return (
      <div className="space-y-2">
        {arr(d.plugins).map((p) => {
          const pp = obj(p);
          return (
            <div key={String(pp.slug)} className="rounded-md border border-line-soft p-2">
              <p className="text-xs font-medium">
                {txt(pp.name ?? pp.slug)} <span className="font-mono text-slate-500">{txt(pp.version)}</span>
              </p>
              <FileList title="Modificati" value={pp.modified} />
              <FileList title="Estranei" value={pp.unknown} />
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
            <p className="break-all font-mono text-[11px] text-ink">
              {txt(f.file)}
              {typeof f.line === "number" ? `:${f.line}` : ""}
            </p>
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
        <p className="text-xs text-slate-500">
          Euristica: verifica ogni file prima di intervenire. I falsi positivi sono possibili (plugin che offuscano il
          proprio codice di licenza, librerie minificate).
        </p>
      </div>
    );
  }
  return null;
}

export default async function VigilantesSitePage({ params }: { params: { id: string } }) {
  if (!(await getAdminSession())) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Sezione riservata agli amministratori.</p>
    );
  }
  const site = await prisma.wpSite.findUnique({
    where: { id: params.id },
    include: {
      client: { select: { id: true, name: true, ragioneSociale: true } },
      components: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      alerts: { orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { openedAt: "desc" }], take: 100 },
    },
  });
  if (!site) notFound();
  const clients = await prisma.client.findMany({
    where: { status: { not: "CESSATO" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, ragioneSociale: true },
  });

  const open = site.alerts.filter((a) => !a.resolvedAt);
  const resolved = site.alerts.filter((a) => a.resolvedAt).slice(0, 20);
  const securityOpen = open.filter((a) => !a.kind.endsWith("_UPDATE"));
  const health = SITE_HEALTH[siteHealth(site, open)];
  const pending = site.components.filter((c) => c.newVersion);
  const plugins = site.components.filter((c) => c.type === "PLUGIN");
  const themes = site.components.filter((c) => c.type === "THEME");
  const report = obj(site.report);
  const env = obj(report.env);
  const security = obj(report.security);
  const integrity = obj(security.integrity);
  const uploads = obj(security.uploads_php);
  const malware = obj(security.malware);
  const pluginIntegrity = obj(security.plugin_integrity);
  const admins = arr(report.admins).map(obj);
  const appUrl = process.env.APP_URL ?? "";
  const connectionKey = buildConnectionKey(appUrl, site.id, site.secret);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vigilantes" className="text-sm text-slate-500 hover:underline">
          ← Vigilantes
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
              <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${health.style}`}>
                {health.label}
              </span>
            </div>
            <a href={site.url} target="_blank" rel="noreferrer" className="font-mono text-sm text-brand hover:underline">
              {site.url}
            </a>
            {site.client ? (
              <p className="mt-1 text-sm text-slate-600">
                Cliente:{" "}
                <Link href={`/clienti/${site.client.id}`} className="hover:underline">
                  {clientDisplayName(site.client)}
                </Link>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <SiteFormButton
              clients={clients.map((c) => ({ id: c.id, label: clientDisplayName(c) }))}
              site={{ id: site.id, name: site.name, url: site.url, clientId: site.clientId, notes: site.notes }}
            />
            <EnabledToggle siteId={site.id} enabled={site.enabled} />
            <DeleteSiteButton siteId={site.id} label={site.name} />
            <CheckNowButton siteId={site.id} />
          </div>
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

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="mono-label">WordPress</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{site.wpVersion ?? "—"}</p>
          <p className="text-xs text-slate-500">PHP {site.phpVersion ?? "—"}</p>
        </div>
        <div className={`card p-4 ${pending.length ? "border-amber-200 bg-amber-50" : ""}`}>
          <p className="mono-label">Aggiornamenti</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${pending.length ? "text-amber-800" : ""}`}>
            {pending.length}
          </p>
          <p className="text-xs text-slate-500">
            {plugins.length} plugin · {themes.length} temi
          </p>
        </div>
        <div className={`card p-4 ${securityOpen.length ? "border-red-200 bg-red-50" : ""}`}>
          <p className="mono-label">Alert sicurezza</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${securityOpen.length ? "text-red-700" : ""}`}>
            {securityOpen.length}
          </p>
          <p className="text-xs text-slate-500">aperti</p>
        </div>
        <div className="card p-4">
          <p className="mono-label">Ultimo report</p>
          <p className="mt-1 text-sm font-semibold">
            {site.lastReportAt ? formatRomeDateTime(site.lastReportAt) : "mai"}
          </p>
          <p className="text-xs text-slate-500">
            {site.lastCheckAt
              ? `controllo ${formatRomeDateTime(site.lastCheckAt)} · ${site.lastCheckOk ? "ok" : "fallito"}`
              : "nessun controllo"}
          </p>
        </div>
      </div>

      {site.lastCheckOk === false && site.lastCheckError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Ultimo controllo fallito ({site.consecutiveFailures} di fila): {site.lastCheckError}
        </p>
      ) : null}

      <section className="card overflow-hidden">
        <h2 className="mono-label border-b border-line px-4 py-3">Alert aperti ({open.length})</h2>
        {open.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Nessun alert aperto.</p>
        ) : (
          <ul>
            {open.map((a) => (
              <li
                key={a.id}
                className={`flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3 last:border-0 ${
                  a.acknowledgedAt ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[a.severity as AlertSeverityValue]}`}
                    >
                      {SEVERITY_LABELS[a.severity as AlertSeverityValue]}
                    </span>
                    <span className="mono-label">{ALERT_KIND_LABELS[a.kind as AlertKindValue]}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">{a.title}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    dal {formatRomeDateTime(a.openedAt)}
                    {a.acknowledgedAt ? ` · visto da ${a.acknowledgedBy ?? "?"}` : ""}
                    {a.notifiedAt ? " · allarme inviato" : ""}
                  </p>
                  <AlertDetails kind={a.kind} details={a.details} />
                </div>
                <AckButton
                  alertId={a.id}
                  acknowledged={!!a.acknowledgedAt}
                  sticky={STICKY_ALERT_KINDS.includes(a.kind as AlertKindValue)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="mono-label border-b border-line px-4 py-3">Core, plugin e temi</h2>
        {site.components.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Nessun dato: in attesa del primo report.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left mono-label">
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Versione</th>
                  <th className="px-3 py-2 font-medium">Disponibile</th>
                  <th className="px-3 py-2 font-medium">Stato</th>
                </tr>
              </thead>
              <tbody>
                {[...site.components]
                  .sort((x, y) => Number(!!y.newVersion) - Number(!!x.newVersion))
                  .map((c) => (
                    <tr key={c.id} className={`border-b border-line-soft last:border-0 ${c.newVersion ? "bg-amber-50/60" : ""}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink">{c.name}</p>
                        {c.type !== "CORE" ? <p className="font-mono text-[11px] text-slate-400">{c.slug}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.type === "CORE" ? "Core" : c.type === "PLUGIN" ? "Plugin" : "Tema"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.version ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {c.newVersion ? (
                          <span className="font-medium text-amber-800">
                            {c.newVersion}
                            {c.updateSince ? (
                              <span className="block font-normal text-slate-500">dal {formatRomeDateTime(c.updateSince)}</span>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {c.type === "CORE" ? "—" : c.active ? "Attivo" : "Disattivato"}
                        {c.autoUpdate ? <span className="block text-emerald-700">auto-update</span> : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mono-label mb-3">Sicurezza</h2>
          <dl>
            <Row
              label="Integrità core"
              value={
                integrity.ok === true
                  ? `Ok (${unixDate(integrity.checked_at)})`
                  : integrity.ok === false
                    ? `File alterati (${unixDate(integrity.checked_at)})`
                    : integrity.error
                      ? `Non verificabile: ${txt(integrity.error)}`
                      : "—"
              }
              warn={integrity.ok === false}
            />
            <Row
              label="PHP in uploads"
              value={uploads.checked_at ? `${arr(uploads.files).length} file (${unixDate(uploads.checked_at)})` : "—"}
              warn={arr(uploads.files).length > 0}
            />
            <Row label="Amministratori" value={admins.length ? admins.map((a) => txt(a.login)).join(", ") : "—"} />
            <Row label="Modifica file da admin" value={env.disallow_file_edit === true ? "Disabilitata" : "Consentita"} />
          </dl>
          <div className="mt-4 border-t border-line-soft pt-4">
            <DeepScanToggle siteId={site.id} enabled={site.deepScan} />
            <p className="mt-1 text-xs text-slate-500">
              Cerca codice offuscato, backdoor e file sospetti, e confronta i plugin di wordpress.org con gli
              originali. Gira sul sito una volta al giorno, a tempo limitato. L&apos;impostazione arriva al plugin al
              prossimo controllo.
            </p>
            {site.deepScan ? (
              <dl className="mt-3">
                <Row
                  label="Codice sospetto"
                  value={
                    malware.checked_at
                      ? `${arr(malware.findings).length} segnalazioni su ${txt(malware.scanned)} file${malware.complete === false ? " (scansione in corso)" : ""} · ${unixDate(malware.checked_at)}`
                      : "in attesa della prima scansione"
                  }
                  warn={arr(malware.findings).length > 0}
                />
                <Row
                  label="Plugin wordpress.org"
                  value={
                    pluginIntegrity.checked_at
                      ? `${txt(pluginIntegrity.checked)} verificati, ${arr(pluginIntegrity.plugins).length} alterati, ${txt(pluginIntegrity.skipped)} non verificabili · ${unixDate(pluginIntegrity.checked_at)}`
                      : "in attesa della prima scansione"
                  }
                  warn={arr(pluginIntegrity.plugins).length > 0}
                />
              </dl>
            ) : null}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="mono-label mb-3">Ambiente</h2>
          <dl>
            <Row label="PHP" value={txt(env.php)} />
            <Row label="Database" value={txt(env.mysql)} />
            <Row label="Server" value={txt(env.server)} />
            <Row label="HTTPS" value={yesNo(env.https)} warn={env.https === false} />
            <Row label="WP_DEBUG" value={yesNo(env.debug)} />
            <Row label="Errori visibili" value={yesNo(env.debug_display)} warn={env.debug_display === true} />
            <Row label="Auto-update core" value={txt(env.auto_update_core)} />
            <Row label="WP-Cron disattivato" value={yesNo(env.wp_cron_disabled)} />
            <Row label="Plugin Vigilantes" value={txt(site.pluginVersion)} />
          </dl>
        </section>
      </div>

      {site.lastReportAt ? (
        <section className="card p-6">
          <h2 className="mono-label mb-3">Chiave di collegamento</h2>
          <ConnectionKeyPanel siteId={site.id} connectionKey={connectionKey} fingerprint={secretFingerprint(site.secret)} />
        </section>
      ) : null}

      {resolved.length > 0 ? (
        <section className="card overflow-hidden">
          <h2 className="mono-label border-b border-line px-4 py-3">Risolti di recente</h2>
          <ul>
            {resolved.map((a) => (
              <li key={a.id} className="border-b border-line-soft px-4 py-2 text-sm last:border-0">
                <span className="text-slate-600">{a.title}</span>
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  risolto il {a.resolvedAt ? formatRomeDateTime(a.resolvedAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {site.notes ? (
        <section className="card p-6">
          <h2 className="mono-label mb-3">Note</h2>
          <p className="whitespace-pre-line text-sm text-ink">{site.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
