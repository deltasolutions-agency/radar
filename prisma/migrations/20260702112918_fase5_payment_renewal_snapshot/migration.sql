-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "previousEndDate" TIMESTAMP(3),
ADD COLUMN     "previousLastRenewalAt" TIMESTAMP(3),
ADD COLUMN     "previousPriceCents" INTEGER;
