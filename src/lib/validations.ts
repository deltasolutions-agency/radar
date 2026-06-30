import { z } from "zod";

/**
 * Schemi di validazione condivisi tra API routes e form client.
 *
 * Le costanti degli enum sono ridefinite qui come array di stringhe (anziché
 * importate da @prisma/client) per mantenere questo modulo isomorfo: può
 * essere importato sia lato server sia in un client component senza trascinare
 * il client Prisma nel bundle del browser.
 *
 * ⚠️ Devono restare allineate agli enum in prisma/schema.prisma.
 */

export const SERVICE_TYPES = [
  "DOMINIO",
  "HOSTING",
  "SSL",
  "PRIVACY",
  "EMAIL",
  "ALTRO",
] as const;
export type ServiceTypeValue = (typeof SERVICE_TYPES)[number];

export const BILLING_PERIODS = [
  "MENSILE",
  "ANNUALE",
  "PERSONALIZZATA",
] as const;
export type BillingPeriodValue = (typeof BILLING_PERIODS)[number];

export const CLIENT_STATUSES = ["ATTIVO", "SOSPESO", "CESSATO"] as const;
export type ClientStatusValue = (typeof CLIENT_STATUSES)[number];

// Etichette leggibili per la UI.
export const SERVICE_TYPE_LABELS: Record<ServiceTypeValue, string> = {
  DOMINIO: "Dominio",
  HOSTING: "Hosting",
  SSL: "SSL",
  PRIVACY: "Privacy",
  EMAIL: "Email",
  ALTRO: "Altro",
};

export const BILLING_PERIOD_LABELS: Record<BillingPeriodValue, string> = {
  MENSILE: "Mensile",
  ANNUALE: "Annuale",
  PERSONALIZZATA: "Personalizzata",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatusValue, string> = {
  ATTIVO: "Attivo",
  SOSPESO: "Sospeso",
  CESSATO: "Cessato",
};

/** Converte "" in undefined così i campi opzionali vuoti non finiscono nel DB. */
const emptyToUndef = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalString = z.preprocess(
  emptyToUndef,
  z.string().trim().max(500).optional(),
);

// ──────────────────────────────────────────────────────────────────────────
// CLIENT
// ──────────────────────────────────────────────────────────────────────────

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(200),
  // email è NOT NULL nello schema → obbligatoria.
  email: z.string().trim().email("Email non valida"),
  phone: optionalString,
  ragioneSociale: optionalString,
  partitaIva: optionalString,
  codiceFiscale: optionalString,
  indirizzo: optionalString,
  citta: optionalString,
  cap: optionalString,
  provincia: optionalString,
  paese: z.preprocess(
    emptyToUndef,
    z.string().trim().max(2).default("IT"),
  ),
  status: z.enum(CLIENT_STATUSES).default("ATTIVO"),
  note: z.preprocess(emptyToUndef, z.string().trim().max(5000).optional()),
});

export const clientUpdateSchema = clientCreateSchema.partial();

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

// ──────────────────────────────────────────────────────────────────────────
// SERVICE
// ──────────────────────────────────────────────────────────────────────────

// Oggetto base, riusato sia per create (intero) sia per update (parziale).
const serviceObject = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(200),
  type: z.enum(SERVICE_TYPES, {
    errorMap: () => ({ message: "Tipo servizio non valido" }),
  }),
  description: z.preprocess(
    emptyToUndef,
    z.string().trim().max(5000).optional(),
  ),
  // Importi in centesimi (interi).
  priceCents: z
    .number({ invalid_type_error: "Prezzo non valido" })
    .int("Il prezzo deve essere in centesimi (intero)")
    .min(0, "Il prezzo non può essere negativo"),
  costCents: z
    .number()
    .int()
    .min(0, "Il costo non può essere negativo")
    .default(0),
  currency: z.preprocess(
    emptyToUndef,
    z.string().trim().toLowerCase().length(3).default("eur"),
  ),
  billingPeriod: z.enum(BILLING_PERIODS, {
    errorMap: () => ({ message: "Periodicità non valida" }),
  }),
  customPeriodDays: z.number().int().positive().optional().nullable(),
  autoRenew: z.boolean().default(true),
  active: z.boolean().default(true),
});

// Per la periodicità PERSONALIZZATA i giorni sono obbligatori.
const requireCustomDays = (s: {
  billingPeriod?: BillingPeriodValue;
  customPeriodDays?: number | null;
}) =>
  s.billingPeriod !== "PERSONALIZZATA" ||
  (s.customPeriodDays != null && s.customPeriodDays > 0);

const customDaysIssue = {
  message:
    "Per la periodicità Personalizzata indica i giorni (customPeriodDays).",
  path: ["customPeriodDays"] as (string | number)[],
};

export const serviceCreateSchema = serviceObject.refine(
  requireCustomDays,
  customDaysIssue,
);

export const serviceUpdateSchema = serviceObject
  .partial()
  .refine(requireCustomDays, customDaysIssue);

export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
