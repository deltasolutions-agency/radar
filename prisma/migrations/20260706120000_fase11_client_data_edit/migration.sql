-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "dataEditToken" TEXT,
ADD COLUMN     "dataEditUnlocked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pec" TEXT,
ADD COLUMN     "sdi" TEXT;

-- CreateTable
CREATE TABLE "client_data_change_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL DEFAULT 'client',
    "changes" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_data_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_data_change_logs_clientId_idx" ON "client_data_change_logs"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_dataEditToken_key" ON "clients"("dataEditToken");

-- AddForeignKey
ALTER TABLE "client_data_change_logs" ADD CONSTRAINT "client_data_change_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

