"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
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
}: {
  mode: "create" | "edit";
  subscriptionId: string;
  itemId?: string;
  initial?: Partial<ItemValues>;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ItemValues>({ ...EMPTY_ITEM, ...initial });
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

    const payload = itemValuesToApi(value);
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

      router.push(`/abbonamenti/${subscriptionId}`);
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
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
        />
      </section>

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
