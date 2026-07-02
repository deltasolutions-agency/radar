-- AlterTable
ALTER TABLE "services" ADD COLUMN     "renewalIncreasePercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "lastRenewalAt" TIMESTAMP(3);
