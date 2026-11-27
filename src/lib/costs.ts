import { z } from "zod";

// Costi sostenuti (hosting, domini, licenze…) ripartiti sugli abbonamenti che
// li usano. Tutti i confronti sono su base ANNUA: un costo mensile pesa 12
// volte, uno biennale metà; i ricavi degli abbonamenti si annualizzano allo
// stesso modo, così il margine è confrontabile tra righe con periodi diversi.

export const COST_PERIODS = [
  { months: 1, label: "Mensile" },
  { months: 3, label: "Trimestrale" },
  { months: 6, label: "Semestrale" },
  { months: 12, label: "Annuale" },
  { months: 24, label: "Biennale" },
  { months: 36, label: "Triennale" },
  { months: 48, label: "Quadriennale" },
] as const;

export function periodLabel(months: number): string {
  return COST_PERIODS.find((p) => p.months === months)?.label ?? `Ogni ${months} mesi`;
}

export const COST_CATEGORY_LABELS = {
  HOSTING: "Hosting",
  DOMINIO: "Dominio",
  CLOUD: "Cloud",
  SSL: "SSL",
  EMAIL: "Email",
  PRIVACY: "Privacy",
  ALTRO: "Altro",
} as const;
export type CostCategory = keyof typeof COST_CATEGORY_LABELS;

/** Aliquota usata quando il costo è segnato "IVA inclusa (detraibile)". */
export const COST_VAT_RATE = 22;

export function vatLabel(vatPercent: number): string {
  return vatPercent > 0 ? `IVA ${vatPercent}% inclusa` : "senza IVA";
}

/** Importo al netto dell'IVA (l'IVA sugli acquisti si detrae: il costo reale è il netto). */
export function netCostCents(amountCents: number, vatPercent: number): number {
  return vatPercent > 0 ? Math.round((amountCents * 100) / (100 + vatPercent)) : amountCents;
}

/**
 * Costo annuo NETTO in centesimi: stesso metro dei prezzi degli abbonamenti,
 * che in Radar sono imponibili (IVA esclusa).
 */
export function annualCostCents(amountCents: number, periodMonths: number, vatPercent = 0): number {
  return Math.round((netCostCents(amountCents, vatPercent) * 12) / Math.max(1, periodMonths));
}

type ItemLike = {
  priceCents: number;
  quantity: number;
  billingPeriod: "MENSILE" | "ANNUALE" | "PERSONALIZZATA";
  customPeriodDays: number | null;
  status: string;
};

/** Ricavo annuo di una riga (0 se cessata). */
export function annualItemRevenueCents(it: ItemLike): number {
  if (it.status === "CESSATO") return 0;
  const amount = it.priceCents * it.quantity;
  if (it.billingPeriod === "MENSILE") return amount * 12;
  if (it.billingPeriod === "ANNUALE") return amount;
  const days = it.customPeriodDays && it.customPeriodDays > 0 ? it.customPeriodDays : 365;
  return Math.round((amount * 365) / days);
}

export function annualSubscriptionRevenueCents(items: ItemLike[]): number {
  return items.reduce((s, it) => s + annualItemRevenueCents(it), 0);
}

/**
 * Quote (in %) di un costo sugli abbonamenti collegati. Le quote fissate
 * restano come sono; il residuo (100 − somma fissate) si divide in parti
 * uguali tra gli abbonamenti senza quota. Se nessuno è senza quota, il
 * residuo resta "non assegnato".
 */
export function resolveShares(
  allocations: { id: string; sharePercent: number | null }[],
): { shares: Map<string, number>; unassignedPercent: number } {
  const fixed = allocations.filter((a) => a.sharePercent !== null);
  const free = allocations.filter((a) => a.sharePercent === null);
  const fixedSum = fixed.reduce((s, a) => s + (a.sharePercent ?? 0), 0);
  const rest = Math.max(0, 100 - fixedSum);
  const shares = new Map<string, number>();
  for (const a of fixed) shares.set(a.id, a.sharePercent ?? 0);
  for (const a of free) shares.set(a.id, rest / free.length);
  const assigned = [...shares.values()].reduce((s, v) => s + v, 0);
  return { shares, unassignedPercent: allocations.length === 0 ? 100 : Math.max(0, 100 - assigned) };
}

export function formatPercent(v: number): string {
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(v)}%`;
}

export const toNumber = (d: { toString(): string } | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());

// ── Validazioni ────────────────────────────────────────────────────────────

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const costSchema = z.object({
  name: z.string().trim().min(1, "Inserisci un nome").max(160),
  supplier: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  category: z.preprocess(
    emptyToUndef,
    z.enum(Object.keys(COST_CATEGORY_LABELS) as [CostCategory, ...CostCategory[]]).optional(),
  ),
  amountCents: z.number().int("Importo non valido").min(0, "Importo non valido").max(100_000_000),
  periodMonths: z.number().int().min(1).max(120),
  vatPercent: z.union([z.literal(0), z.literal(22)]).default(0),
  general: z.boolean().default(false),
  recurring: z.boolean().default(false),
  renewalDate: z.preprocess(
    emptyToUndef,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida").optional(),
  ),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(5000).optional()),
  active: z.boolean().optional(),
});
export type CostInput = z.infer<typeof costSchema>;

/** Un costo ricorrente ha bisogno della data del prossimo rinnovo. */
export const costSchemaChecked = costSchema.refine((d) => !d.recurring || !!d.renewalDate, {
  message: "Per un costo ricorrente indica la data del prossimo rinnovo",
  path: ["renewalDate"],
});

const share = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number().min(0.01, "Quota tra 0,01 e 100").max(100, "Quota tra 0,01 e 100").nullable(),
);

export const allocationCreateSchema = z.object({
  subscriptionId: z.string().trim().min(1, "Scegli un abbonamento"),
  sharePercent: share.optional(),
});
export const allocationUpdateSchema = z.object({ sharePercent: share });

export function dayFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

// ── Rinnovi ────────────────────────────────────────────────────────────────

/** Destinatario dell'avviso rinnovi costi. */
export const COST_ALERT_RECIPIENT = "hello@deltasolutions.agency";
/** Giorni di preavviso: l'avviso parte da qui e si ripete ogni giorno. */
export const COST_ALERT_DAYS = 7;

/** Aggiunge mesi a un giorno YYYY-MM-DD (31 gen + 1 mese → 28/29 feb). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * Prossima data di rinnovo di un costo ricorrente: se è già passata, la sposta
 * avanti di un periodo alla volta finché non è oggi o nel futuro. La data
 * successiva si calcola sempre dalla data originale (niente slittamenti di
 * fine mese).
 */
export function nextRenewalYmd(renewalYmd: string, periodMonths: number, todayYmd: string): string {
  let k = 0;
  let next = renewalYmd;
  while (next < todayYmd && k < 1200) {
    k += 1;
    next = addMonthsYmd(renewalYmd, periodMonths * k);
  }
  return next;
}

/** Giorni da oggi alla data (negativo = già passata). */
export function daysUntil(ymd: string, todayYmd: string): number {
  return Math.round((dayFromYmd(ymd).getTime() - dayFromYmd(todayYmd).getTime()) / 86_400_000);
}
