-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "creditNoteDate" TIMESTAMP(3),
ADD COLUMN     "creditNoteIssuedAt" TIMESTAMP(3),
ADD COLUMN     "creditNoteNumber" TEXT,
ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoicedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");

-- CreateIndex
CREATE INDEX "payments_invoicedAt_idx" ON "payments"("invoicedAt");
