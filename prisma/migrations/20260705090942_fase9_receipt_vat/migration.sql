-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "taxableAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vatAmountCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill ricevute già emesse: scorporo IVA 22% dal totale (amountCents = lordo).
-- Imponibile = round(totale / 1.22); IVA = totale − imponibile (coerente al centesimo).
UPDATE "receipts"
SET "taxableAmountCents" = ROUND("amountCents"::numeric / 1.22),
    "vatAmountCents" = "amountCents" - ROUND("amountCents"::numeric / 1.22);
