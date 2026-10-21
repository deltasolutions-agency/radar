-- AlterTable
ALTER TABLE "auto_charge_activation_reminders" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "pendingRetry" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscription_items" ADD COLUMN     "autoChargeReconcileAt" TIMESTAMP(3),
ADD COLUMN     "autoChargeReconcileNote" TEXT;

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cron_runs_name_startedAt_idx" ON "cron_runs"("name", "startedAt");
