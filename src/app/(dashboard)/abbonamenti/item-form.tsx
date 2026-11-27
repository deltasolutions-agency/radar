"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MANUAL_PAYMENT_METHODS,
  subscriptionItemCreateSchema,
  subscriptionItemUpdateSchema,
} from "@/lib/validations";
import {
  ItemFields,
  EMPTY_ITEM,
  itemValuesToApi,
  type ItemValues,
  type ServiceOption,
} from "./item-fields";

/**
 * Form di UNA riga di servizio: aggiunta a un abbonamento esistente (create) o
 * modifica di una riga (edit). Non gestisce lo stato (gestito da Cessa) né il
 * pagamento (gestito dal dettaglio).
 */
export function ItemForm({
  mode,
  subscriptionId,
  itemId,
  initial,
  endClientSuggestions = [],
  renewalState,
  allowAutoCharge = true,
  paidOption,
}: {
  allowAutoCharge?: boolean;
  /**
   * Solo nuovi servizi su abbonamenti ATTIVI: spunta "Già pagato" con il metodo
   * preimpostato dal metodo preferito dell'abbonamento.
   */
  paidOption?: { defaultMethod: string; preferredLabel: string };
  mode: "create" | "edit";
  subscriptionId: string;
  itemId?: string;
  initial?: Partial<ItemValues>;
  endClientSuggestions?: string[];
  renewalState?: {
    initialMode: "EVERY_RENEWAL" | "ONCE";
    appliedAt: string | null;
    hasPastIncrease: boolean;
  };
}) {
  const router = useRouter();
  const [value, setValue] = useState<ItemValues>({ ...EMPTY_ITEM, ...initial });
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState(paidOption?.defaultMethod ?? MANUAL_PAYMENT_METHODS[0]);
  const [paidAt, setPaidAt] = useState("");
  const [paidNote, setPaidNote] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/services")
      .then((r) => r.json())
      .then((s) => {
        if (active) setServices(s.services ?? []);
      })
      .catch(() => {
        if (active) setFormError("Impossibile caricare i servizi");
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);

    const payload = itemValuesToApi(
      value,
      services.find((s) => s.id === value.serviceId)?.renewalIncreasePercent,
    );
    const schema =
      mode === "create"
        ? subscriptionItemCreateSchema
        : subscriptionItemUpdateSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key =
          issue.path.join(".") === "priceCents"
            ? "priceEuro"
            : issue.path.join(".") || "_";
        if (!fe[key]) fe[key] = issue.message;
      }
      setErrors(fe);
      return;
    }

    setPending(true);
    const endpoint =
      mode === "create"
        ? `/api/subscriptions/${subscriptionId}/items`
        : `/api/subscription-items/${itemId}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create" && paidOption && alreadyPaid
            ? {
                ...parsed.data,
                alreadyPaid: { method: paidMethod, paidAt: paidAt || undefined, note: paidNote || undefined },
              }
            : parsed.data,
        ),
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

      router.push(
        body.paymentError
          ? `/abbonamenti/${subscriptionId}?pagamentoServizio=errore`
          : mode === "create" && paidOption && alreadyPaid
            ? `/abbonamenti/${subscriptionId}?tab=pagamenti`
            : `/abbonamenti/${subscriptionId}`,
      );
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
        <h2 className="mono-label">Dati servizio</h2>
        <ItemFields
          idPrefix="item"
          value={value}
          services={services}
          errors={errors}
          endClientSuggestions={endClientSuggestions}
          renewalState={renewalState}
          suggestEndDate={mode === "create"}
          allowAutoCharge={allowAutoCharge || !!value.autoChargeEnabled}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
        />
      </section>

      {paidOption ? (
        <section className="card space-y-4 p-6">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} />
            <span>
              <span className="font-medium">Già pagato</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Registra subito il pagamento di questo servizio, con ricevuta. Le date restano quelle indicate sopra (il periodo pagato).
                Metodo preferito dal cliente: {paidOption.preferredLabel}.
              </span>
            </span>
          </label>
          {alreadyPaid ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="paidMethod" className="field-label">
                  Metodo
                </label>
                <select id="paidMethod" className="field" value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)}>
                  {[...new Set([paidMethod, ...MANUAL_PAYMENT_METHODS])].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="paidAt" className="field-label">
                  Data pagamento
                </label>
                <input id="paidAt" type="date" className="field" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="paidNote" className="field-label">
                  Note
                </label>
                <input
                  id="paidNote"
                  className="field"
                  placeholder="es. bonifico del 12/06"
                  value={paidNote}
                  onChange={(e) => setPaidNote(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Senza spunta il servizio resta da pagare: lo incassi dal pulsante &quot;Pagamento&quot; dell&apos;abbonamento.</p>
          )}
        </section>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? "Salvataggio…"
            : mode === "create"
              ? "Aggiungi servizio"
              : "Salva modifiche"}
        </button>
        <Link href={`/abbonamenti/${subscriptionId}`} className="btn-ghost">
          Annulla
        </Link>
      </div>
    </form>
  );
}
