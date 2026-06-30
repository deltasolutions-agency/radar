"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  serviceCreateSchema,
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  BILLING_PERIODS,
  BILLING_PERIOD_LABELS,
} from "@/lib/validations";

type ServiceValues = {
  id?: string;
  name: string;
  type: string;
  description: string;
  priceEuro: string;
  costEuro: string;
  billingPeriod: string;
  customPeriodDays: string;
  autoRenew: boolean;
  active: boolean;
};

const EMPTY: ServiceValues = {
  name: "",
  type: "HOSTING",
  description: "",
  priceEuro: "",
  costEuro: "",
  billingPeriod: "ANNUALE",
  customPeriodDays: "",
  autoRenew: true,
  active: true,
};

/** "12,50" / "12.50" → 1250 centesimi; "" → NaN. */
function euroToCents(input: string): number {
  const n = parseFloat(input.replace(",", ".").trim());
  return Math.round(n * 100);
}

export function ServiceForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: Partial<ServiceValues> & { id?: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState<ServiceValues>({
    ...EMPTY,
    ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isCustom = values.billingPeriod === "PERSONALIZZATA";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);

    const priceCents = euroToCents(values.priceEuro);
    const costCents = values.costEuro.trim()
      ? euroToCents(values.costEuro)
      : 0;

    const payload = {
      name: values.name,
      type: values.type,
      description: values.description,
      priceCents: Number.isNaN(priceCents) ? undefined : priceCents,
      costCents: Number.isNaN(costCents) ? 0 : costCents,
      currency: "eur",
      billingPeriod: values.billingPeriod,
      customPeriodDays: isCustom
        ? parseInt(values.customPeriodDays, 10) || undefined
        : null,
      autoRenew: values.autoRenew,
      active: values.active,
    };

    const parsed = serviceCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // priceCents/costCents → li mostriamo sul campo euro corrispondente.
        let key = issue.path.join(".") || "_";
        if (key === "priceCents") key = "priceEuro";
        if (key === "costCents") key = "costEuro";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    const endpoint =
      mode === "create" ? "/api/services" : `/api/services/${initial?.id}`;
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
            const key =
              k === "priceCents"
                ? "priceEuro"
                : k === "costCents"
                  ? "costEuro"
                  : k;
            mapped[key] = v;
          }
          setErrors(mapped);
        } else {
          setFormError(body.error ?? "Salvataggio non riuscito");
        }
        setPending(false);
        return;
      }

      const id = body.service?.id ?? initial?.id;
      router.push(id ? `/servizi/${id}` : "/servizi");
      router.refresh();
    } catch {
      setFormError("Errore di rete durante il salvataggio");
      setPending(false);
    }
  }

  const setV = <K extends keyof ServiceValues>(k: K, v: ServiceValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {formError ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Dettagli servizio</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="field-label">
              Nome <span className="text-red-600">*</span>
            </label>
            <input
              id="name"
              className="field"
              value={values.name}
              onChange={(e) => setV("name", e.target.value)}
            />
            {errors.name ? (
              <p className="mt-1 text-xs text-red-600">{errors.name}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="type" className="field-label">
              Tipo <span className="text-red-600">*</span>
            </label>
            <select
              id="type"
              className="field"
              value={values.type}
              onChange={(e) => setV("type", e.target.value)}
            >
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SERVICE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {errors.type ? (
              <p className="mt-1 text-xs text-red-600">{errors.type}</p>
            ) : null}
          </div>
        </div>
        <div>
          <label htmlFor="description" className="field-label">
            Descrizione
          </label>
          <textarea
            id="description"
            rows={3}
            className="field"
            value={values.description}
            onChange={(e) => setV("description", e.target.value)}
          />
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Economia & rinnovo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="priceEuro" className="field-label">
              Prezzo di vendita (€) <span className="text-red-600">*</span>
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
            <label htmlFor="costEuro" className="field-label">
              Costo fornitore (€)
            </label>
            <input
              id="costEuro"
              inputMode="decimal"
              placeholder="es. 12,00"
              className="field"
              value={values.costEuro}
              onChange={(e) => setV("costEuro", e.target.value)}
            />
            {errors.costEuro ? (
              <p className="mt-1 text-xs text-red-600">{errors.costEuro}</p>
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

        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.autoRenew}
              onChange={(e) => setV("autoRenew", e.target.checked)}
            />
            Rinnovo automatico
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => setV("active", e.target.checked)}
            />
            Attivo
          </label>
        </div>
      </section>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? "Salvataggio…"
            : mode === "create"
              ? "Crea servizio"
              : "Salva modifiche"}
        </button>
        <Link
          href={initial?.id ? `/servizi/${initial.id}` : "/servizi"}
          className="btn-ghost"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}
