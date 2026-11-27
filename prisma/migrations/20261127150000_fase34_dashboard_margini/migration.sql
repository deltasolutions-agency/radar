-- Fase 34: soglie di margine per gli avvisi della dashboard.
CREATE TABLE "dashboard_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "marginWarnPercent" INTEGER NOT NULL DEFAULT 75,
    "marginAlertPercent" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "dashboard_settings_pkey" PRIMARY KEY ("id")
);
