-- Fase 23 — Amministrazione: crediti (Incassi) e debiti (Dovuto) inseriti a mano.
-- Solo aggiunte: nessuna tabella esistente viene modificata.

-- AlterEnum
ALTER TYPE "EmailLogType" ADD VALUE 'LEDGER_OVERDUE_ALERT';

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('CREDITO', 'DEBITO');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "counterparty" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidNote" TEXT,
    "notes" TEXT,
    "lastAlertAt" TIMESTAMP(3),
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_kind_paidAt_idx" ON "ledger_entries"("kind", "paidAt");

-- CreateIndex
CREATE INDEX "ledger_entries_dueDate_idx" ON "ledger_entries"("dueDate");
