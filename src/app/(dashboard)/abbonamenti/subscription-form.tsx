"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { subscriptionCreateSchema, MANUAL_PAYMENT_METHODS } from "@/lib/validations";
import {
  ItemFields,
  EMPTY_ITEM,
  itemValuesToApi,
  type ItemValues,
  type ServiceOption,
} from "./item-fields";

type ClientOption = { id: string; name: string; ragioneSociale: string | null };

/**
 * Creazione di un abbonamento: contenitore (cliente + note) con una o più righe
 * di servizio (SubscriptionItem). Ogni riga ha scadenza/prezzo/periodicità e
 * rinnovo automatico indipendenti.
 */
export function SubscriptionForm() {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(false);
  const [requestAutoCharge, setRequestAutoCharge] = useState(false);
  // Nuovo abbonamento: "da pagare" (default) o "già pagato" (pagamento manuale).
  const [paymentMode, setPaymentMode] = useState<"DA_PAGARE" | "PAGATO">("DA_PAGARE");
  const [manualMethod, setManualMethod] = useState<string>(MANUAL_PAYMENT_METHODS[0]);
  const [manualPaidAt, setManualPaidAt] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [items, setItems] = useState<ItemValues[]>([{ ...EMPTY_ITEM }]);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<number, Record<string, string>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Carica clienti e servizi (cookie di sessione inviato in automatico).
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

  // Clienti finali già usati per il cliente selezionato (autocomplete).
  const [endClientSuggestions, setEndClientSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!clientId) {
      setEndClientSuggestions([]);
      return;
    }
    let active = true;
    fetch(`/api/clients/${clientId}/end-clients`)
      .then((r) => r.json())
      .then((b) => {
        if (active) setEndClientSuggestions(b.endClients ?? []);
      })
      .catch(() => {
        if (active) setEndClientSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  function patchItem(index: number, patch: Partial<ItemValues>) {
    setItems((arr) =>
      arr.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((arr) => [...arr, { ...EMPTY_ITEM }]);
  }
  function removeItem(index: number) {
    setItems((arr) => arr.filter((_, i) => i !== index));
    setItemErrors({});
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);
    setItemErrors({});
    setFormError(null);

    const payload = {
      clientId,
      notes: notes || undefined,
      serviceFeeEnabled,
      // "Da pagare": il rinnovo automatico si attiva dalla pagina di pagamento.
      requestAutoCharge: paymentMode === "PAGATO" && requestAutoCharge,
      paymentMode,
      ...(paymentMode === "PAGATO"
        ? {
            manualPayment: {
              method: manualMethod,
              paidAt: manualPaidAt || undefined,
              note: manualNote || undefined,
            },
          }
        : {}),
      items: items.map((it) =>
        itemValuesToApi(
          it,
          services.find((s) => s.id === it.serviceId)?.renewalIncreasePercent,
        ),
      ),
    };

    const parsed = subscriptionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const nextItemErrors: Record<number, Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        const [head, idx, field] = issue.path;
        if (head === "clientId") {
          setClientError(issue.message);
        } else if (head === "items" && typeof idx === "number") {
          const key = (field as string) === "priceCents" ? "priceEuro" : (field as string) ?? "_";
          nextItemErrors[idx] = { ...(nextItemErrors[idx] ?? {}), [key]: issue.message };
        } else {
          setFormError(issue.message);
        }
      }
      setItemErrors(nextItemErrors);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFormError(body.error ?? "Salvataggio non riuscito");
        setPending(false);
        return;
      }

      const id = body.subscription?.id;
      // Esito di link/attivazione mostrato nel dettaglio.
      const notice =
        paymentMode === "DA_PAGARE"
          ? body.firstPayment?.emailSent
            ? "?primoPagamento=inviato"
            : "?primoPagamento=non-inviato"
          : body.activationError
            ? "?attivazione=errore"
            : "";
      router.push(id ? `/abbonamenti/${id}${notice}` : "/abbonamenti");
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
        <h2 className="mono-label">Cliente</h2>
        <div>
          <label htmlFor="clientId" className="field-label">
            Cliente <span className="text-red-600">*</span>
          </label>
          <select
            id="clientId"
            className="field"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">— Seleziona —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ragioneSociale?.trim() ? `${c.ragioneSociale} — ` : ""}
                {c.name}
              </option>
            ))}
          </select>
          {clientError ? (
            <p className="mt-1 text-xs text-red-600">{clientError}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="notes" className="field-label">
            Note abbonamento
          </label>
          <textarea
            id="notes"
            rows={2}
            className="field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="rounded-lg border border-line-soft bg-canvas p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={serviceFeeEnabled}
              onChange={(e) => setServiceFeeEnabled(e.target.checked)}
            />
            <span>
              Applica costi di servizio (1,5%)
              <span className="mt-0.5 block text-xs text-slate-500">
                Se attivo, aggiunge un costo di servizio dell&apos;1,5% ai
                pagamenti Stripe di questo abbonamento.
              </span>
            </span>
          </label>
        </div>
        <fieldset className="rounded-lg border border-line-soft bg-canvas p-4">
          <legend className="px-1 text-sm font-medium text-ink">
            Pagamento <span className="text-red-600">*</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white p-3 text-sm ${
                paymentMode === "DA_PAGARE" ? "border-brand ring-1 ring-brand" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="paymentMode"
                className="mt-0.5"
                checked={paymentMode === "DA_PAGARE"}
                onChange={() => setPaymentMode("DA_PAGARE")}
              />
              <span>
                Da pagare
                <span className="mt-0.5 block text-xs text-slate-500">
                  Nasce in attesa del primo pagamento: il cliente riceve il link
                  &quot;Paga ora&quot; con i prezzi indicati qui (nessun aumento).
                  Si attiva quando paga.
                </span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white p-3 text-sm ${
                paymentMode === "PAGATO" ? "border-brand ring-1 ring-brand" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="paymentMode"
                className="mt-0.5"
                checked={paymentMode === "PAGATO"}
                onChange={() => setPaymentMode("PAGATO")}
              />
              <span>
                Già pagato
                <span className="mt-0.5 block text-xs text-slate-500">
                  Attivo subito: registra il primo pagamento manuale con
                  ricevuta.
                </span>
              </span>
            </label>
          </div>
          {paymentMode === "PAGATO" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="manualMethod" className="field-label">
                  Metodo
                </label>
                <select
                  id="manualMethod"
                  className="field"
                  value={manualMethod}
                  onChange={(e) => setManualMethod(e.target.value)}
                >
                  {MANUAL_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="manualPaidAt" className="field-label">
                  Data pagamento
                </label>
                <input
                  id="manualPaidAt"
                  type="date"
                  className="field"
                  value={manualPaidAt}
                  onChange={(e) => setManualPaidAt(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="manualNote" className="field-label">
                  Note
                </label>
                <input
                  id="manualNote"
                  className="field"
                  placeholder="es. bonifico del 12/06"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </fieldset>
        {paymentMode === "PAGATO" ? (
        <div className="rounded-lg border border-line-soft bg-canvas p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requestAutoCharge}
              onChange={(e) => setRequestAutoCharge(e.target.checked)}
            />
            <span>
              Richiedi al cliente l&apos;attivazione del rinnovo automatico
              <span className="mt-0.5 block text-xs text-slate-500">
                Alla creazione invia al cliente il link per registrare la carta e
                attivare il rinnovo automatico su tutti i servizi di questo
                abbonamento (integrato nella mail di benvenuto se è il primo
                abbonamento del cliente).
              </span>
            </span>
          </label>
        </div>
        ) : (
          <p className="text-xs text-slate-500">
            Rinnovo automatico: il cliente può attivarlo direttamente dalla
            pagina di pagamento del primo pagamento.
          </p>
        )}
      </section>

      {items.map((item, index) => (
        <section key={index} className="card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="mono-label">Servizio {index + 1}</h2>
            {items.length > 1 ? (
              <button
                type="button"
                className="text-xs font-medium text-red-600 hover:underline"
                onClick={() => removeItem(index)}
              >
                Rimuovi
              </button>
            ) : null}
          </div>
          <ItemFields
            idPrefix={`item-${index}`}
            value={item}
            services={services}
            errors={itemErrors[index] ?? {}}
            endClientSuggestions={endClientSuggestions}
            suggestEndDate
            onChange={(patch) => patchItem(index, patch)}
          />
        </section>
      ))}

      <button
        type="button"
        className="btn-ghost"
        onClick={addItem}
      >
        + Aggiungi servizio
      </button>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvataggio…" : "Crea abbonamento"}
        </button>
        <Link href="/abbonamenti" className="btn-ghost">
          Annulla
        </Link>
      </div>
    </form>
  );
}
