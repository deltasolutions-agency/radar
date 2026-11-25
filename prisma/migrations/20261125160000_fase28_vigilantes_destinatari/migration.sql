-- Fase 28 — Vigilantes: destinatari aggiuntivi degli alert per sito e file
-- segnati come innocui. Solo aggiunte.

-- CreateEnum
CREATE TYPE "WpRecipientMode" AS ENUM ('ALL', 'CRITICAL', 'DIGEST');

-- AlterTable
ALTER TABLE "wp_sites" ADD COLUMN "ignoredPaths" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "wp_alert_recipients" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mode" "WpRecipientMode" NOT NULL DEFAULT 'CRITICAL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wp_alert_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wp_alert_recipients_siteId_email_key" ON "wp_alert_recipients"("siteId", "email");

-- AddForeignKey
ALTER TABLE "wp_alert_recipients" ADD CONSTRAINT "wp_alert_recipients_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
