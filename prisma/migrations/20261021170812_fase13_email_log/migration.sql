-- CreateEnum
CREATE TYPE "EmailLogType" AS ENUM ('REMINDER', 'AUTOCHARGE_NOTICE', 'AUTOCHARGE_FAILED', 'AUTOCHARGE_REQUEST', 'AUTOCHARGE_ACTIVATION_REMINDER', 'ADMIN_ESCALATION', 'ADMIN_SUMMARY', 'WELCOME', 'PAYMENT_RECEIPT', 'PAYMENT_LINK', 'REFUND', 'DATA_CHANGE_NOTICE', 'DATA_UPDATE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EmailTrigger" AS ENUM ('CRON', 'MANUAL', 'WEBHOOK', 'SYSTEM', 'CLIENT');

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "EmailLogType" NOT NULL,
    "status" "EmailLogStatus" NOT NULL,
    "trigger" "EmailTrigger" NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "bcc" TEXT[],
    "replyTo" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "attachmentNames" TEXT[],
    "resendId" TEXT,
    "errorMessage" TEXT,
    "clientId" TEXT,
    "subscriptionId" TEXT,
    "dueDate" TIMESTAMP(3),
    "itemIds" TEXT[],
    "dedupeKey" TEXT,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_logs_dedupeKey_key" ON "email_logs"("dedupeKey");

-- CreateIndex
CREATE INDEX "email_logs_createdAt_idx" ON "email_logs"("createdAt");

-- CreateIndex
CREATE INDEX "email_logs_type_idx" ON "email_logs"("type");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE INDEX "email_logs_clientId_idx" ON "email_logs"("clientId");

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
