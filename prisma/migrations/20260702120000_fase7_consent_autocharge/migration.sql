-- AlterTable
ALTER TABLE "clients" ADD COLUMN "stripeDefaultPaymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "autoChargeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoChargeEndDate" TIMESTAMP(3),
ADD COLUMN "autoChargeFailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "autoChargeLastAttemptAt" TIMESTAMP(3);

-- AlterTable (payToken: aggiunta sicura per righe esistenti in produzione)
ALTER TABLE "payments" ADD COLUMN "payToken" TEXT;
UPDATE "payments" SET "payToken" = md5(random()::text || clock_timestamp()::text || id) WHERE "payToken" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "payToken" SET NOT NULL;

-- CreateTable
CREATE TABLE "consent_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PRIVACY_TC',
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_logs_clientId_idx" ON "consent_logs"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payToken_key" ON "payments"("payToken");

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
