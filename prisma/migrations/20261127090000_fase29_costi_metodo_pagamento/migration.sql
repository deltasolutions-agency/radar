-- Fase 29: metodo di pagamento preferito sugli abbonamenti + costi ripartiti.

-- CreateEnum
CREATE TYPE "PreferredPaymentMethod" AS ENUM ('CARTA', 'BONIFICO', 'CONTANTI');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "preferredPaymentMethod" "PreferredPaymentMethod" NOT NULL DEFAULT 'CARTA';

-- CreateTable
CREATE TABLE "costs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplier" TEXT,
    "category" "ServiceType",
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "renewalDate" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocations" (
    "id" TEXT NOT NULL,
    "costId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "costs_active_idx" ON "costs"("active");
CREATE UNIQUE INDEX "cost_allocations_costId_subscriptionId_key" ON "cost_allocations"("costId", "subscriptionId");
CREATE INDEX "cost_allocations_subscriptionId_idx" ON "cost_allocations"("subscriptionId");

-- AddForeignKey
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_costId_fkey" FOREIGN KEY ("costId") REFERENCES "costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
