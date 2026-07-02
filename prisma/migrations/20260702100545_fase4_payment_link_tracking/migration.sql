-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "linkSentAt" TIMESTAMP(3);
