// Amministrazione — crediti (Incassi) e debiti (Dovuto) inseriti a mano.
// Sezione indipendente dagli abbonamenti: nessun legame con clienti, pagamenti
// o Stripe. Importi così come inseriti, senza calcolo IVA.
// Modulo puro (usabile anche lato client): etichette, date, regole di alert.

import { z } from "zod";

export const LEDGER_KINDS = ["CREDITO", "DEBITO"] as const;
export type LedgerKindValue = (typeof LEDGER_KINDS)[number];

/** Tab della sezione: slug URL ↔ tipo. */
export const LEDGER_TABS = {
  incassi: "CREDITO",
  dovuto: "DEBITO",
} as const satisfies Record<string, LedgerKindValue>;
export type LedgerTabSlug = keyof typeof LEDGER_TABS;

export const LEDGER_TEXT: Record<
  LedgerKindValue,
  {
    tab: string;
    slug: LedgerTabSlug;
    intro: string;
    counterparty: string;
    counterpartyPlaceholder: string;
    paid: string;
    paidAction: string;
    unpaidAction: string;
    open: string;
    newEntry: string;
    empty: string;
    alertHeading: string;
  }
> = {
  CREDITO: {
    tab: "Incassi",
    slug: "incassi",
    intro: "Quanto ti devono i clienti, con la scadenza entro cui dovrebbero pagarti.",
    counterparty: "Cliente / debitore",
    counterpartyPlaceholder: "es. Rossi Arredamenti",
    paid: "Incassato",
    paidAction: "Segna come incassato",
    unpaidAction: 'Togliere "incassato"?',
    open: "Da incassare",
    newEntry: "Nuovo credito",
    empty: "Nessun credito inserito.",
    alertHeading: "Incassi scaduti: clienti che dovevano pagarti",
  },
  DEBITO: {
    tab: "Dovuto",
    slug: "dovuto",
    intro: "Quanto devi pagare tu, con la scadenza entro cui saldare.",
    counterparty: "A chi / creditore",
    counterpartyPlaceholder: "es. Aruba, commercialista",
    paid: "Pagato",
    paidAction: "Segna come pagato",
    unpaidAction: 'Togliere "pagato"?',
    open: "Da pagare",
    newEntry: "Nuovo dovuto",
    empty: "Nessun dovuto inserito.",
    alertHeading: "Dovuto scaduto: pagamenti che dovevi fare",
  },
};

/** Primo alert il giorno dopo la scadenza, poi un richiamo ogni N giorni. */
export const LEDGER_ALERT_REPEAT_DAYS = 7;

/** Destinatario degli alert di scadenza. */
export const LEDGER_ALERT_RECIPIENT = "hello@deltasolutions.agency";

const MS_PER_DAY = 86_400_000;

/** "YYYY-MM-DD" → istante a mezzanotte UTC (così si salvano i giorni). */
export function dayFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Giorno salvato a mezzanotte UTC → "YYYY-MM-DD". */
export function ymdOfDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

/** Giorno → "dd/mm/yyyy". */
export function formatDay(d: Date | string | null | undefined): string {
  const ymd = ymdOfDay(d);
  return ymd ? ymd.split("-").reverse().join("/") : "—";
}

/** Giorni di ritardo rispetto a oggi (Europe/Rome, YYYY-MM-DD); ≤0 = non scaduto. */
export function daysLate(dueDate: Date | string | null | undefined, todayYmd: string): number {
  const due = ymdOfDay(dueDate);
  if (!due) return 0;
  return Math.round((dayFromYmd(todayYmd).getTime() - dayFromYmd(due).getTime()) / MS_PER_DAY);
}

export type LedgerState = "PAID" | "OVERDUE" | "DUE_SOON" | "OPEN";

/** Stato sintetico: pagato, scaduto, in scadenza (≤7 gg) o aperto. */
export function ledgerState(
  e: { paidAt: Date | string | null; dueDate: Date | string | null },
  todayYmd: string,
): LedgerState {
  if (e.paidAt) return "PAID";
  if (!e.dueDate) return "OPEN";
  const late = daysLate(e.dueDate, todayYmd);
  if (late > 0) return "OVERDUE";
  if (late >= -7) return "DUE_SOON";
  return "OPEN";
}

/**
 * Va inviato un alert oggi? Aperto, con scadenza superata (dal giorno dopo),
 * e mai avvisato oppure avvisato da almeno LEDGER_ALERT_REPEAT_DAYS giorni.
 */
export function needsLedgerAlert(
  e: { paidAt: Date | null; dueDate: Date | null; lastAlertAt: Date | null },
  todayYmd: string,
  lastAlertYmd: string | null,
): boolean {
  if (e.paidAt || !e.dueDate) return false;
  if (daysLate(e.dueDate, todayYmd) < 1) return false;
  if (!e.lastAlertAt || !lastAlertYmd) return true;
  return daysLate(dayFromYmd(lastAlertYmd), todayYmd) >= LEDGER_ALERT_REPEAT_DAYS;
}

/** "1.234,56" / "1234.56" / "1234" → centesimi; null se non valido. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "");
  if (!s) return null;
  // Formato italiano: punti per le migliaia, virgola decimale.
  // "1.250" senza virgola = milleduecentocinquanta (non 1,25).
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

// ── Validazione API ─────────────────────────────────────────────────────────

const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida")
  .refine((v) => !Number.isNaN(dayFromYmd(v).getTime()), "Data non valida");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const ledgerCreateSchema = z.object({
  kind: z.enum(LEDGER_KINDS),
  counterparty: z.string().trim().min(1, "Indica a chi si riferisce").max(200),
  description: optionalText(500),
  amountCents: z
    .number({ invalid_type_error: "Importo non valido" })
    .int()
    .positive("L'importo deve essere maggiore di zero")
    .max(100_000_000_00),
  dueDate: ymdSchema.optional().nullable(),
  notes: optionalText(2000),
});

export const ledgerUpdateSchema = ledgerCreateSchema.omit({ kind: true }).partial().extend({
  /** true = segna pagato (paidAt = paidDate o oggi), false = riapre. */
  paid: z.boolean().optional(),
  paidDate: ymdSchema.optional().nullable(),
  paidNote: optionalText(300),
});
