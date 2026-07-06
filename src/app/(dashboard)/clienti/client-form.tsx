"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  clientCreateSchema,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
} from "@/lib/validations";

type ClientValues = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  ragioneSociale: string;
  partitaIva: string;
  codiceFiscale: string;
  indirizzo: string;
  citta: string;
  cap: string;
  provincia: string;
  paese: string;
  sdi: string;
  pec: string;
  status: string;
  note: string;
};

const EMPTY: ClientValues = {
  name: "",
  email: "",
  phone: "",
  ragioneSociale: "",
  partitaIva: "",
  codiceFiscale: "",
  indirizzo: "",
  citta: "",
  cap: "",
  provincia: "",
  paese: "IT",
  sdi: "",
  pec: "",
  status: "ATTIVO",
  note: "",
};

function Field({
  label,
  name,
  value,
  onChange,
  error,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function ClientForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: Partial<ClientValues> & { id?: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState<ClientValues>({
    ...EMPTY,
    ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (k: keyof ClientValues) => (v: string) =>
    setValues((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);

    // Validazione client-side per messaggi immediati.
    const parsed = clientCreateSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    const endpoint =
      mode === "create" ? "/api/clients" : `/api/clients/${initial?.id}`;
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
          setErrors(body.details);
        } else {
          setFormError(body.error ?? "Salvataggio non riuscito");
        }
        setPending(false);
        return;
      }

      const id = body.client?.id ?? initial?.id;
      router.push(id ? `/clienti/${id}` : "/clienti");
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
        <h2 className="mono-label">Contatto</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nome / Referente"
            name="name"
            value={values.name}
            onChange={set("name")}
            error={errors.name}
            required
          />
          <Field
            label="Email"
            name="email"
            type="email"
            value={values.email}
            onChange={set("email")}
            error={errors.email}
            required
          />
          <Field
            label="Telefono"
            name="phone"
            value={values.phone}
            onChange={set("phone")}
            error={errors.phone}
          />
          <div>
            <label htmlFor="status" className="field-label">
              Stato
            </label>
            <select
              id="status"
              value={values.status}
              onChange={(e) => set("status")(e.target.value)}
              className="field"
            >
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Fatturazione</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ragione sociale"
            name="ragioneSociale"
            value={values.ragioneSociale}
            onChange={set("ragioneSociale")}
            error={errors.ragioneSociale}
          />
          <Field
            label="Partita IVA"
            name="partitaIva"
            value={values.partitaIva}
            onChange={set("partitaIva")}
            error={errors.partitaIva}
          />
          <Field
            label="Codice fiscale"
            name="codiceFiscale"
            value={values.codiceFiscale}
            onChange={set("codiceFiscale")}
            error={errors.codiceFiscale}
          />
          <Field
            label="Indirizzo"
            name="indirizzo"
            value={values.indirizzo}
            onChange={set("indirizzo")}
            error={errors.indirizzo}
          />
          <Field
            label="Città"
            name="citta"
            value={values.citta}
            onChange={set("citta")}
            error={errors.citta}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="CAP"
              name="cap"
              value={values.cap}
              onChange={set("cap")}
              error={errors.cap}
            />
            <Field
              label="Prov."
              name="provincia"
              value={values.provincia}
              onChange={set("provincia")}
              error={errors.provincia}
            />
          </div>
          <Field
            label="Paese"
            name="paese"
            value={values.paese}
            onChange={set("paese")}
            error={errors.paese}
          />
          <Field
            label="Codice SDI"
            name="sdi"
            value={values.sdi}
            onChange={set("sdi")}
            error={errors.sdi}
          />
          <Field
            label="PEC"
            name="pec"
            type="email"
            value={values.pec}
            onChange={set("pec")}
            error={errors.pec}
          />
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="mono-label">Note</h2>
        <textarea
          name="note"
          value={values.note}
          onChange={(e) => set("note")(e.target.value)}
          rows={4}
          className="field"
          placeholder="Annotazioni interne…"
        />
      </section>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? "Salvataggio…"
            : mode === "create"
              ? "Crea cliente"
              : "Salva modifiche"}
        </button>
        <Link
          href={initial?.id ? `/clienti/${initial.id}` : "/clienti"}
          className="btn-ghost"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}
