import {
  SERVICE_TYPE_LABELS,
  CLIENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type ServiceTypeValue,
  type ClientStatusValue,
  type SubscriptionStatusValue,
  type PaymentStatusValue,
} from "@/lib/validations";

// Colori distinti e leggibili per tipo servizio (coerenti con la dashboard).
const TYPE_STYLES: Record<ServiceTypeValue, string> = {
  DOMINIO: "bg-blue-50 text-blue-700 border-blue-200",
  HOSTING: "bg-violet-50 text-violet-700 border-violet-200",
  SSL: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PRIVACY: "bg-amber-50 text-amber-700 border-amber-200",
  EMAIL: "bg-sky-50 text-sky-700 border-sky-200",
  ALTRO: "bg-slate-100 text-slate-600 border-slate-200",
};

export function ServiceTypeBadge({ type }: { type: ServiceTypeValue }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide ${TYPE_STYLES[type]}`}
    >
      {SERVICE_TYPE_LABELS[type]}
    </span>
  );
}

const STATUS_STYLES: Record<ClientStatusValue, string> = {
  ATTIVO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  SOSPESO: "bg-amber-50 text-amber-700 border-amber-200",
  CESSATO: "bg-slate-100 text-slate-500 border-slate-200",
};

export function ClientStatusBadge({ status }: { status: ClientStatusValue }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {CLIENT_STATUS_LABELS[status]}
    </span>
  );
}

// Stati abbonamento: verde/arancione/rosso/giallo/blu/grigio.
const SUBSCRIPTION_STATUS_STYLES: Record<SubscriptionStatusValue, string> = {
  ATTIVO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  IN_SCADENZA: "bg-orange-50 text-orange-700 border-orange-200",
  SCADUTO: "bg-red-50 text-red-700 border-red-200",
  SOSPESO: "bg-yellow-50 text-yellow-700 border-yellow-200",
  RINNOVATO: "bg-blue-50 text-blue-700 border-blue-200",
  CESSATO: "bg-slate-100 text-slate-500 border-slate-200",
};

export function SubscriptionStatusBadge({
  status,
}: {
  status: SubscriptionStatusValue;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${SUBSCRIPTION_STATUS_STYLES[status]}`}
    >
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </span>
  );
}

const PAYMENT_STATUS_STYLES: Record<PaymentStatusValue, string> = {
  IN_ATTESA: "bg-amber-50 text-amber-700 border-amber-200",
  CONFERMATO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FALLITO: "bg-red-50 text-red-700 border-red-200",
  RIMBORSATO: "bg-slate-100 text-slate-500 border-slate-200",
};

export function PaymentStatusBadge({
  status,
}: {
  status: PaymentStatusValue;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_STYLES[status]}`}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-500"
      }`}
    >
      {active ? "Attivo" : "Disattivo"}
    </span>
  );
}
