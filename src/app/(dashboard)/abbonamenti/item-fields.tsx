"use client";

import { BILLING_PERIODS, BILLING_PERIOD_LABELS } from "@/lib/validations";

/** Valori di una riga di servizio nel form (stringhe = input controllati). */
export type ItemValues = {
  serviceId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  priceEuro: string;
  billingPeriod: string;
  customPeriodDays: string;
  autoChargeEnabled: boolean;
  autoChargeEndDate: string; // YYYY-MM-DD
  notes: string;
};

export const EMPTY_ITEM: ItemValues = {
  serviceId: "",
  startDate: "",
  endDate: "",
  priceEuro: "",
  billingPeriod: "ANNUALE",
  customPeriodDays: "",
  autoChargeEnabled: false,
  autoChargeEndDate: "",
  notes: "",
};

export type ServiceOption = {
  id: string;
  name: string;
  priceCents: number;
  billingPeriod: string;
  customPeriodDays: number | null;
};

/** "12,50" / "12.50" → 1250 centesimi; "" → NaN. */
export function euroToCents(input: string): number {
  const n = parseFloat(input.replace(",", ".").trim());
  return Math.round(n * 100);
}

/**
 * Converte i valori di form di una riga nel payload API (subscriptionItem*).
 */
export function itemValuesToApi(v: ItemValues) {
  const isCustom = v.billingPeriod === "PERSONALIZZATA";
  const priceCents = euroToCents(v.priceEuro);
  return {
    serviceId: v.serviceId,
    startDate: v.startDate,
    endDate: v.endDate,
    priceCents: Number.isNaN(priceCents) ? undefined : priceCents,
    currency: "eur",
    billingPeriod: v.billingPeriod,
    customPeriodDays: isCustom
      ? parseInt(v.customPeriodDays, 10) || undefined
      : null,
    autoChargeEnabled: v.autoChargeEnabled,
    autoChargeEndDate:
      v.autoChargeEnabled && v.autoChargeEndDate ? v.autoChargeEndDate : null,
    notes: v.notes || undefined,
  };
}

/**
 * Campi di UNA riga di servizio, controllati dal genitore. Riusati sia dal form
 * di creazione abbonamento (repeater multi-riga) sia dal form di singola riga.
 */
export function ItemFields({
  idPrefix,
  value,
  services,
  errors,
  onChange,
}: {
  idPrefix: string;
  value: ItemValues;
  services: ServiceOption[];
  errors: Record<string, string>;
  onChange: (patch: Partial<ItemValues>) => void;
}) {
  const isCustom = value.billingPeriod === "PERSONALIZZATA";

  function onServiceChange(serviceId: string) {
    const svc = services.find((s) => s.id === serviceId);
    onChange({
      serviceId,
      // Pre-popola prezzo/periodicità dallo snapshot catalogo se il prezzo è vuoto.
      priceEuro:
        svc && !value.priceEuro
          ? (svc.priceCents / 100).toFixed(2)
          : value.priceEuro,
      billingPeriod: svc ? svc.billingPeriod : value.billingPeriod,
      customPeriodDays:
        svc?.customPeriodDays != null
          ? String(svc.customPeriodDays)
          : value.customPeriodDays,
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-serviceId`} className="field-label">
            Servizio <span className="text-red-600">*</span>
          </label>
          <select
            id={`${idPrefix}-serviceId`}
            className="field"
            value={value.serviceId}
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

        <div>
          <label htmlFor={`${idPrefix}-startDate`} className="field-label">
            Data di inizio <span className="text-red-600">*</span>
          </label>
          <input
            id={`${idPrefix}-startDate`}
            type="date"
            className="field"
            value={value.startDate}
            onChange={(e) => onChange({ startDate: e.target.value })}
          />
          {errors.startDate ? (
            <p className="mt-1 text-xs text-red-600">{errors.startDate}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-endDate`} className="field-label">
            Data di scadenza <span className="text-red-600">*</span>
          </label>
          <input
            id={`${idPrefix}-endDate`}
            type="date"
            className="field"
            value={value.endDate}
            onChange={(e) => onChange({ endDate: e.target.value })}
          />
          {errors.endDate ? (
            <p className="mt-1 text-xs text-red-600">{errors.endDate}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor={`${idPrefix}-priceEuro`} className="field-label">
            Prezzo (€) <span className="text-red-600">*</span>
          </label>
          <input
            id={`${idPrefix}-priceEuro`}
            inputMode="decimal"
            placeholder="es. 49,00"
            className="field"
            value={value.priceEuro}
            onChange={(e) => onChange({ priceEuro: e.target.value })}
          />
          {errors.priceEuro ? (
            <p className="mt-1 text-xs text-red-600">{errors.priceEuro}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-billingPeriod`} className="field-label">
            Periodicità <span className="text-red-600">*</span>
          </label>
          <select
            id={`${idPrefix}-billingPeriod`}
            className="field"
            value={value.billingPeriod}
            onChange={(e) => onChange({ billingPeriod: e.target.value })}
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
            <label
              htmlFor={`${idPrefix}-customPeriodDays`}
              className="field-label"
            >
              Giorni periodo <span className="text-red-600">*</span>
            </label>
            <input
              id={`${idPrefix}-customPeriodDays`}
              inputMode="numeric"
              placeholder="es. 90"
              className="field"
              value={value.customPeriodDays}
              onChange={(e) => onChange({ customPeriodDays: e.target.value })}
            />
            {errors.customPeriodDays ? (
              <p className="mt-1 text-xs text-red-600">
                {errors.customPeriodDays}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-line-soft bg-canvas p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.autoChargeEnabled}
            onChange={(e) => onChange({ autoChargeEnabled: e.target.checked })}
          />
          Abilita rinnovo automatico (addebito ricorrente su carta)
        </label>
        {value.autoChargeEnabled ? (
          <div className="mt-3">
            <label
              htmlFor={`${idPrefix}-autoChargeEndDate`}
              className="field-label"
            >
              Data di fine addebito automatico (opzionale)
            </label>
            <input
              id={`${idPrefix}-autoChargeEndDate`}
              type="date"
              className="field"
              value={value.autoChargeEndDate}
              onChange={(e) => onChange({ autoChargeEndDate: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500">
              L&apos;addebito richiede comunque una carta registrata dal cliente.
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-notes`} className="field-label">
          Note riga
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          className="field"
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}
