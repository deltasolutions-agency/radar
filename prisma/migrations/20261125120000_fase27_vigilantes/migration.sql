-- Fase 27 — Vigilantes: monitoraggio dei siti WordPress (core, plugin, temi,
-- sicurezza). Solo aggiunte: nessuna tabella esistente viene modificata.

-- AlterEnum
ALTER TYPE "EmailLogType" ADD VALUE 'WP_MONITOR_DIGEST';
ALTER TYPE "EmailLogType" ADD VALUE 'WP_MONITOR_ALERT';

-- CreateEnum
CREATE TYPE "WpComponentType" AS ENUM ('CORE', 'PLUGIN', 'THEME');

-- CreateEnum
CREATE TYPE "WpAlertKind" AS ENUM ('CORE_UPDATE', 'PLUGIN_UPDATE', 'THEME_UPDATE', 'SITE_UNREACHABLE', 'AGENT_ERROR', 'NEW_ADMIN', 'CORE_INTEGRITY', 'UPLOADS_PHP', 'DEBUG_ENABLED', 'PLUGIN_INTEGRITY', 'MALWARE_SUSPECT');

-- CreateEnum
CREATE TYPE "WpAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "wp_sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clientId" TEXT,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deepScan" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "wpVersion" TEXT,
    "phpVersion" TEXT,
    "pluginVersion" TEXT,
    "lastReportAt" TIMESTAMP(3),
    "lastReportSource" TEXT,
    "report" JSONB,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wp_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_components" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "WpComponentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "newVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "autoUpdate" BOOLEAN NOT NULL DEFAULT false,
    "updateSince" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wp_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_alerts" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "WpAlertKind" NOT NULL,
    "severity" "WpAlertSeverity" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "wp_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wp_sites_url_key" ON "wp_sites"("url");

-- CreateIndex
CREATE INDEX "wp_sites_clientId_idx" ON "wp_sites"("clientId");

-- CreateIndex
CREATE INDEX "wp_components_siteId_idx" ON "wp_components"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "wp_components_siteId_type_slug_key" ON "wp_components"("siteId", "type", "slug");

-- CreateIndex
CREATE INDEX "wp_alerts_resolvedAt_idx" ON "wp_alerts"("resolvedAt");

-- CreateIndex
CREATE INDEX "wp_alerts_siteId_resolvedAt_idx" ON "wp_alerts"("siteId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "wp_alerts_siteId_key_key" ON "wp_alerts"("siteId", "key");

-- AddForeignKey
ALTER TABLE "wp_sites" ADD CONSTRAINT "wp_sites_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_components" ADD CONSTRAINT "wp_components_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_alerts" ADD CONSTRAINT "wp_alerts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
