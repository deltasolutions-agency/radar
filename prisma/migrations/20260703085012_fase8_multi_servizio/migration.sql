-- DropForeignKey
ALTER TABLE "notification_logs" DROP CONSTRAINT "notification_logs_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_serviceId_fkey";

-- DropIndex
DROP INDEX "notification_logs_subscriptionId_idx";

-- DropIndex
DROP INDEX "notification_logs_subscriptionId_type_dedupeKey_key";

-- DropIndex
DROP INDEX "payments_method_idx";

-- DropIndex
DROP INDEX "subscriptions_autoChargeSetupToken_key";

-- DropIndex
DROP INDEX "subscriptions_endDate_idx";

-- DropIndex
DROP INDEX "subscriptions_serviceId_idx";

-- DropIndex
DROP INDEX "subscriptions_status_idx";

-- DropIndex
DROP INDEX "subscriptions_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "welcomeEmailSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_logs" DROP COLUMN "subscriptionId",
ADD COLUMN     "subscriptionItemId" TEXT;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "periodEnd",
DROP COLUMN "periodStart",
DROP COLUMN "previousEndDate",
DROP COLUMN "previousLastRenewalAt",
DROP COLUMN "previousPriceCents";

-- AlterTable
ALTER TABLE "receipts" DROP COLUMN "description",
DROP COLUMN "periodEnd",
DROP COLUMN "periodStart",
DROP COLUMN "serviceName";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "autoChargeEnabled",
DROP COLUMN "autoChargeEndDate",
DROP COLUMN "autoChargeFailCount",
DROP COLUMN "autoChargeLastAttemptAt",
DROP COLUMN "autoChargeSetupToken",
DROP COLUMN "autoRenew",
DROP COLUMN "billingPeriod",
DROP COLUMN "currency",
DROP COLUMN "customPeriodDays",
DROP COLUMN "endDate",
DROP COLUMN "lastRenewalAt",
DROP COLUMN "note",
DROP COLUMN "paymentMethod",
DROP COLUMN "priceCents",
DROP COLUMN "serviceId",
DROP COLUMN "startDate",
DROP COLUMN "status",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ATTIVO',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "billingPeriod" "BillingPeriod" NOT NULL,
    "customPeriodDays" INTEGER,
    "lastRenewalAt" TIMESTAMP(3),
    "autoChargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoChargeEndDate" TIMESTAMP(3),
    "autoChargeFailCount" INTEGER NOT NULL DEFAULT 0,
    "autoChargeLastAttemptAt" TIMESTAMP(3),
    "autoChargeSetupToken" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_items" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "subscriptionItemId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'IN_ATTESA',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "previousEndDate" TIMESTAMP(3),
    "previousPriceCents" INTEGER,
    "previousLastRenewalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_items_autoChargeSetupToken_key" ON "subscription_items"("autoChargeSetupToken");

-- CreateIndex
CREATE INDEX "subscription_items_subscriptionId_idx" ON "subscription_items"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_items_serviceId_idx" ON "subscription_items"("serviceId");

-- CreateIndex
CREATE INDEX "subscription_items_status_idx" ON "subscription_items"("status");

-- CreateIndex
CREATE INDEX "subscription_items_endDate_idx" ON "subscription_items"("endDate");

-- CreateIndex
CREATE INDEX "payment_items_paymentId_idx" ON "payment_items"("paymentId");

-- CreateIndex
CREATE INDEX "payment_items_subscriptionItemId_idx" ON "payment_items"("subscriptionItemId");

-- CreateIndex
CREATE INDEX "receipt_lines_receiptId_idx" ON "receipt_lines"("receiptId");

-- CreateIndex
CREATE INDEX "notification_logs_subscriptionItemId_idx" ON "notification_logs"("subscriptionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_subscriptionItemId_type_dedupeKey_key" ON "notification_logs"("subscriptionItemId", "type", "dedupeKey");

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_subscriptionItemId_fkey" FOREIGN KEY ("subscriptionItemId") REFERENCES "subscription_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_subscriptionItemId_fkey" FOREIGN KEY ("subscriptionItemId") REFERENCES "subscription_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

