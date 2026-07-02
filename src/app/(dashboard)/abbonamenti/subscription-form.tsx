"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  subscriptionCreateSchema,
  BILLING_PERIODS,
  BILLING_PERIOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/validations";

type SubscriptionValues = {
  id?: string;
  clientId: string;
  serviceId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  priceEuro: string;
  billingPeriod: string;
  customPeriodDays: string;
  paymentMethod: string;
  autoRenew: boolean;
  note: string;
};

type ClientOption = { id: string; name: string; ragioneSociale: string | null };
type ServiceOption = {
  id: string;
  name: string;
  priceCents: number;
  billingPeriod: string;
  customPeriodDays: number | null;
};

const EMPTY: SubscriptionValues = {
  clientId: "",
  serviceId: "",
  startDate: "",
  endDate: "",
  priceEuro: "",
  billingPeriod: "ANNUALE",
  customPeriodDays: "",
  paymentMethod: "MANUALE",
  autoRenew: true,
  note: "",
};

/** "12,50" / "12.50" → 1250 centesimi; "" → NaN. */
function euroToCents(input: string): number {
  const n = parseFloat(input.replace(",", ".").trim());
  return Math.round(n * 100);
}

export function SubscriptionForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: Partial<SubscriptionValues> & { id?: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState<SubscriptionValues>({
    ...EMPTY,
    ...initial,
  });
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Carica clienti e servizi dalle API (cookie di sessione inviato in automatico).
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/clients").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
    ])
      .then(([c, s]) => {
        if (!active) return;
        setClients(c.clients ?? []);
        setServices(s.services ?? []);
      })
      .catch(() => {
        if (active) setFormError("Impossibile caricare clienti e servizi");
      });
    return () => {
      active = false;
    };
  }, []);

  const isCustom = values.billingPeriod === "PERSONALIZZATA";

  const setV = <K extends keyof SubscriptionValues>(
    k: K,
    v: SubscriptionValues[K],
  ) => setValues((s) => ({ ...s, [k]: v }));

  // Alla selezione del servizio, pre-popola prezzo e periodicità (solo se vuoti
  // o in creazione) leggendo lo snapshot dal catalogo.
  function onServiceChange(serviceId: string) {
    const svc = services.find((s) => s.id === serviceId);
    setValues((s) => ({
      ...s,
      serviceId,
      priceEuro:
        svc && (mode === "create" || !s.priceEuro)
          ? (svc.priceCents / 100).toFixed(2)
          : s.priceEuro,
      billingPeriod: svc ? svc.billingPeriod : s.billingPeriod,
      customPeriodDays:
        svc?.customPeriodDays != null
          ? String(svc.customPeriodDays)
          : s.customPeriodDays,
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);

    const priceCents = euroToCents(values.priceEuro);

    const payload = {
      clientId: values.clientId,
      serviceId: values.serviceId,
      startDate: values.startDate,
      endDate: values.endDate,
      priceCents: Number.isNaN(priceCents) ? undefined : priceCents,
      currency: "eur",
      billingPeriod: values.billingPeriod,
      customPeriodDays: isCustom
        ? parseInt(values.customPeriodDays, 10) || undefined
        : null,
      paymentMethod: values.paymentMethod,
      autoRenew: values.autoRenew,
      note: values.note,
    };

    const parsed = subscriptionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        let key = issue.path.join(".") || "_";
        if (key === "priceCents") key = "priceEuro";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    const endpoint =
      mode === "create"
        ? "/api/subscriptions"
        : `/api/subscriptions/${initial?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 400 && body.details) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(
            body.details as Record<string, string>,
          )) {
            mapped[k === "priceCents" ? "priceEuro" : k] = v;
          }
          setErrors(mapped);
        } else {
          setFormError(body.error ?? "Salvataggio non riuscito");
        }
        setPending(false);
        return;
      }

      const id = body.subscription?.id ?? initial?.id;
      router.push(id ? `/abbonamenti/${id}` : "/abbonamenti");
      router.refresh();
    } catch {
      setFormError("Errore di rete durante il salvataggio");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {formError ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Cliente & servizio</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="clientId" className="field-label">
              Cliente <span className="text-red-600">*</span>
            </label>
            <select
              id="clientId"
              className="field"
              value={values.clientId}
              onChange={(e) => setV("clientId", e.target.value)}
            >
              <option value="">— Seleziona —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ragioneSociale?.trim() ? `${c.ragioneSociale} — ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
            {errors.clientId ? (
              <p className="mt-1 text-xs text-red-600">{errors.clientId}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="serviceId" className="field-label">
              Servizio <span className="text-red-600">*</span>
            </label>
            <select
              id="serviceId"
              className="field"
              value={values.serviceId}
              onChange={(e) => onServiceChange(e.target.value)}
            >
              <option value="">— Seleziona —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {errors.serviceId ? (
              <p className="mt-1 text-xs text-red-600">{errors.serviceId}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Periodo & prezzo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="startDate" className="field-label">
              Data di inizio <span className="text-red-600">*</span>
            </label>
            <input
              id="startDate"
              type="date"
              className="field"
              value={values.startDate}
              onChange={(e) => setV("startDate", e.target.value)}
            />
            {errors.startDate ? (
              <p className="mt-1 text-xs text-red-600">{errors.startDate}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="endDate" className="field-label">
              Data di scadenza <span className="text-red-600">*</span>
            </label>
            <input
              id="endDate"
              type="date"
              className="field"
              value={values.endDate}
              onChange={(e) => setV("endDate", e.target.value)}
            />
            {errors.endDate ? (
              <p className="mt-1 text-xs text-red-600">{errors.endDate}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="priceEuro" className="field-label">
              Prezzo (€) <span className="text-red-600">*</span>
            </label>
            <input
              id="priceEuro"
              inputMode="decimal"
              placeholder="es. 49,00"
              className="field"
              value={values.priceEuro}
              onChange={(e) => setV("priceEuro", e.target.value)}
            />
            {errors.priceEuro ? (
              <p className="mt-1 text-xs text-red-600">{errors.priceEuro}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="billingPeriod" className="field-label">
              Periodicità <span className="text-red-600">*</span>
            </label>
            <select
              id="billingPeriod"
              className="field"
              value={values.billingPeriod}
              onChange={(e) => setV("billingPeriod", e.target.value)}
            >
              {BILLING_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {BILLING_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          {isCustom ? (
            <div>
              <label htmlFor="customPeriodDays" className="field-label">
                Giorni periodo <span className="text-red-600">*</span>
              </label>
              <input
                id="customPeriodDays"
                inputMode="numeric"
                placeholder="es. 90"
                className="field"
                value={values.customPeriodDays}
                onChange={(e) => setV("customPeriodDays", e.target.value)}
              />
              {errors.customPeriodDays ? (
                <p className="mt-1 text-xs text-red-600">
                  {errors.customPeriodDays}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Pagamento</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="paymentMethod" className="field-label">
              Metodo di pagamento
            </label>
            <select
              id="paymentMethod"
              className="field"
              value={values.paymentMethod}
              onChange={(e) => setV("paymentMethod", e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pt-7 text-sm">
            <input
              type="checkbox"
              checked={values.autoRenew}
              onChange={(e) => setV("autoRenew", e.target.checked)}
            />
            Rinnovo automatico
          </label>
        </div>
        <div>
          <label htmlFor="note" className="field-label">
            Note
          </label>
          <textarea
            id="note"
            rows={3}
            className="field"
            value={values.note}
            onChange={(e) => setV("note", e.target.value)}
          />
        </div>
      </section>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? "Salvataggio…"
            : mode === "create"
              ? "Crea abbonamento"
              : "Salva modifiche"}
        </button>
        <Link
          href={initial?.id ? `/abbonamenti/${initial.id}` : "/abbonamenti"}
          className="btn-ghost"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}
