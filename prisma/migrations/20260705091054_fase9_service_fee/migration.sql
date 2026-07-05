-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "serviceFeeCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "serviceFeeCents" INTEGER NOT NULL DEFAULT 0;
