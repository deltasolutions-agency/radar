-- CreateTable
CREATE TABLE "admin_action_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_action_logs_createdAt_idx" ON "admin_action_logs"("createdAt");

-- CreateIndex
CREATE INDEX "admin_action_logs_entityType_entityId_idx" ON "admin_action_logs"("entityType", "entityId");
