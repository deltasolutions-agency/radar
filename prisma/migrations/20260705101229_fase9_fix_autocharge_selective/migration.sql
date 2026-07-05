-- CreateTable
CREATE TABLE "auto_charge_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "itemIds" TEXT[],
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_charge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_charge_requests_token_key" ON "auto_charge_requests"("token");

-- CreateIndex
CREATE INDEX "auto_charge_requests_clientId_idx" ON "auto_charge_requests"("clientId");

-- AddForeignKey
ALTER TABLE "auto_charge_requests" ADD CONSTRAINT "auto_charge_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
