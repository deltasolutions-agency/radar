-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "autoChargeSetupToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_autoChargeSetupToken_key" ON "subscriptions"("autoChargeSetupToken");
