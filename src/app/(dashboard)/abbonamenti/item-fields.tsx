"use client";

import {
  BILLING_PERIODS,
  BILLING_PERIOD_LABELS,
  END_CLIENT_NAME_MAX,
} from "@/lib/validations";
import { formatEur } from "@/lib/format";
import { upcomingRenewalPrices } from "@/lib/renewal-price";

/** Valori di una riga di servizio nel form (stringhe = input controllati). */
export type ItemValues = {
  serviceId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  priceEuro: string;
  quantity: string; // intero ≥ 1
  billingPeriod: string;
  customPeriodDays: string;
  autoChargeEnabled: boolean;
  autoChargeEndDate: string; // YYYY-MM-DD
  notes: string;
  endClientName: string;
  /** % di aumento al rinnovo (precompilata con quella del servizio). */
  increasePercent: string;
  /** true = ONCE: aumento una sola volta, poi prezzo bloccato. */
  lockAfterFirstIncrease: boolean;
};

export const EMPTY_ITEM: ItemValues = {
  serviceId: "",
  startDate: "",
  endDate: "",
  priceEuro: "",
  quantity: "1",
  billingPeriod: "ANNUALE",
  customPeriodDays: "",
  autoChargeEnabled: false,
  autoChargeEndDate: "",
  notes: "",
  endClientName: "",
  increasePercent: "",
  lockAfterFirstIncrease: false,
};

export type ServiceOption = {
  id: string;
  name: string;
  priceCents: number;
  billingPeriod: string;
  customPeriodDays: number | null;
  renewalIncreasePercent: number;
};

/** "10" → 10; "" / non valido → null (usa la % del servizio). */
function parsePercent(input: string): number | null {
  if (!input.trim()) return null;
  const n = Number(input.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "12,50" / "12.50" → 1250 centesimi; "" → NaN. */
export function euroToCents(input: string): number {
  const n = parseFloat(input.replace(",", ".").trim());
  return Math.round(n * 100);
}

/**
 * Converte i valori di form di una riga nel payload API (subscriptionItem*).
 */
export function itemValuesToApi(
  v: ItemValues,
  /** % del servizio scelto: se il campo coincide, nessun override sulla riga. */
  servicePercent?: number,
) {
  const pct = parsePercent(v.increasePercent);
  const isCustom = v.billingPeriod === "PERSONALIZZATA";
  const priceCents = euroToCents(v.priceEuro);
  const quantity = parseInt(v.quantity, 10);
  return {
    serviceId: v.serviceId,
    startDate: v.startDate,
    endDate: v.endDate,
    priceCents: Number.isNaN(priceCents) ? undefined : priceCents,
    quantity: Number.isNaN(quantity) ? 1 : quantity,
    currency: "eur",
    billingPeriod: v.billingPeriod,
    customPeriodDays: isCustom
      ? parseInt(v.customPeriodDays, 10) || undefined
      : null,
    autoChargeEnabled: v.autoChargeEnabled,
    autoChargeEndDate:
      v.autoChargeEnabled && v.autoChargeEndDate ? v.autoChargeEndDate : null,
    notes: v.notes || undefined,
    // Stringa vuota → null lato schema (svuota il cliente finale).
    endClientName: v.endClientName.trim(),
    renewalIncreaseMode: v.lockAfterFirstIncrease ? "ONCE" : "EVERY_RENEWAL",
    renewalIncreasePercentOverride:
      pct == null || pct === servicePercent ? null : pct,
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
  endClientSuggestions = [],
  renewalState,
}: {
  idPrefix: string;
  value: ItemValues;
  services: ServiceOption[];
  errors: Record<string, string>;
  onChange: (patch: Partial<ItemValues>) => void;
  /** Clienti finali già usati per lo stesso cliente (autocomplete). */
  endClientSuggestions?: string[];
  /** Stato attuale della riga (modifica) per l'anteprima dei rinnovi. */
  renewalState?: {
    initialMode: "EVERY_RENEWAL" | "ONCE";
    appliedAt: string | null;
    hasPastIncrease: boolean;
  };
}) {
  const isCustom = value.billingPeriod === "PERSONALIZZATA";
  const selectedService = services.find((s) => s.id === value.serviceId);

  // Anteprima dei prossimi rinnovi (stessa funzione usata da rinnovi e cron).
  const renewalPreview = (() => {
    const unit = euroToCents(value.priceEuro);
    const qty = parseInt(value.quantity, 10) || 1;
    if (Number.isNaN(unit)) return null;
    const pct = parsePercent(value.increasePercent) ?? selectedService?.renewalIncreasePercent ?? 0;
    const mode = value.lockAfterFirstIncrease ? "ONCE" : "EVERY_RENEWAL";
    // Passaggio a ONCE di una riga già aumentata: prezzo bloccato subito.
    const appliedAt =
      renewalState?.appliedAt ??
      (mode === "ONCE" &&
      renewalState?.initialMode !== "ONCE" &&
      renewalState?.hasPastIncrease
        ? new Date().toISOString()
        : null);
    const [next, second, third] = upcomingRenewalPrices(
      {
        priceCents: unit,
        renewalIncreaseMode: mode,
        renewalIncreaseAppliedAt: appliedAt,
        renewalIncreasePercentOverride: pct,
        service: { renewalIncreasePercent: pct },
      },
      3,
    ).map((p) => formatEur(p * qty));
    const after = second === third ? second : `${second} → ${third}…`;
    return `Prossimo rinnovo: ${next} netti · Rinnovi successivi: ${after} netti`;
  })();

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
      // % di aumento precompilata con quella del servizio.
      increasePercent: svc
        ? String(svc.renewalIncreasePercent)
        : value.increasePercent,
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

        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-endClientName`} className="field-label">
            Cliente finale
          </label>
          <input
            id={`${idPrefix}-endClientName`}
            type="text"
            className="field"
            maxLength={END_CLIENT_NAME_MAX}
            list={`${idPrefix}-endClientName-list`}
            autoComplete="off"
            placeholder="Facoltativo: cliente dell'agenzia a cui si riferisce il servizio"
            value={value.endClientName}
            onChange={(e) => onChange({ endClientName: e.target.value })}
          />
          <datalist id={`${idPrefix}-endClientName-list`}>
            {endClientSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {errors.endClientName ? (
            <p className="mt-1 text-xs text-red-600">{errors.endClientName}</p>
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
          <label htmlFor={`${idPrefix}-quantity`} className="field-label">
            Quantità <span className="text-red-600">*</span>
          </label>
          <input
            id={`${idPrefix}-quantity`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="1"
            className="field"
            value={value.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
          {errors.quantity ? (
            <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Il totale della riga è prezzo × quantità.
            </p>
          )}
        </div>
        <div className="sm:col-span-2 space-y-2 rounded-lg border border-line-soft p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${idPrefix}-increasePercent`} className="field-label">
                Aumento al rinnovo (%)
              </label>
              <input
                id={`${idPrefix}-increasePercent`}
                type="number"
                min={0}
                max={100}
                step={1}
                className="field"
                value={value.increasePercent}
                placeholder={selectedService ? String(selectedService.renewalIncreasePercent) : "0"}
                onChange={(e) => onChange({ increasePercent: e.target.value })}
              />
              {errors.renewalIncreasePercentOverride ? (
                <p className="mt-1 text-xs text-red-600">
                  {errors.renewalIncreasePercentOverride}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Predefinita dal servizio
                  {selectedService ? ` (${selectedService.renewalIncreasePercent}%)` : ""}.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 pt-6 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.lockAfterFirstIncrease}
                onChange={(e) => onChange({ lockAfterFirstIncrease: e.target.checked })}
              />
              <span>
                Blocca il prezzo dopo il primo aumento
                <span className="block text-xs text-slate-500">
                  L&apos;aumento si paga già al prossimo rinnovo, poi il prezzo resta fisso.
                </span>
              </span>
            </label>
          </div>
          {renewalPreview ? (
            <p className="font-mono text-xs text-slate-600">{renewalPreview}</p>
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
