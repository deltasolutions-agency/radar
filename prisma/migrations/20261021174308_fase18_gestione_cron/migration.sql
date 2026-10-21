-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "CronTrigger" AS ENUM ('CRON', 'MANUAL');

-- AlterTable
ALTER TABLE "cron_runs" ADD COLUMN     "status" "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
ADD COLUMN     "trigger" "CronTrigger" NOT NULL DEFAULT 'CRON',
ADD COLUMN     "triggeredBy" TEXT;

-- AlterTable
ALTER TABLE "reminder_settings" ADD COLUMN     "autoChargeMaxDelayDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "cron_settings" (
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,

    CONSTRAINT "cron_settings_pkey" PRIMARY KEY ("name")
);

-- Esecuzioni già registrate: stato coerente con l'esito.
UPDATE "cron_runs" SET "status" = 'FAILED' WHERE "error" IS NOT NULL;
UPDATE "cron_runs" SET "status" = 'SUCCESS' WHERE "error" IS NULL AND "finishedAt" IS NOT NULL;

-- I tre cron, attivi.
INSERT INTO "cron_settings" ("name", "enabled", "updatedAt") VALUES
  ('reminders', true, CURRENT_TIMESTAMP),
  ('auto-charge', true, CURRENT_TIMESTAMP),
  ('autocharge-reminders', true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
