-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('RENEWAL', 'ACTIVATION');

-- CreateEnum
CREATE TYPE "SubscriptionActivationState" AS ENUM ('ACTIVE', 'PENDING_FIRST_PAYMENT', 'CANCELLED_BEFORE_START');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailLogType" ADD VALUE 'FIRST_PAYMENT_LINK';
ALTER TYPE "EmailLogType" ADD VALUE 'FIRST_PAYMENT_REMINDER';
ALTER TYPE "EmailLogType" ADD VALUE 'FIRST_PAYMENT_ADMIN_ALERT';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'RENEWAL';

-- AlterTable
ALTER TABLE "reminder_settings" ADD COLUMN     "firstPaymentAdminAlertDay" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "firstPaymentReminderDays" INTEGER[] DEFAULT ARRAY[3, 7]::INTEGER[];

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "activationState" "SubscriptionActivationState" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "firstPaymentLinkSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscriptions_activationState_idx" ON "subscriptions"("activationState");
