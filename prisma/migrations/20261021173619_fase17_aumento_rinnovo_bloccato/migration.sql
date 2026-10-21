-- CreateEnum
CREATE TYPE "RenewalIncreaseMode" AS ENUM ('EVERY_RENEWAL', 'ONCE');

-- AlterTable
ALTER TABLE "payment_items" ADD COLUMN     "onceIncreaseApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previousRenewalIncreaseAppliedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscription_items" ADD COLUMN     "renewalIncreaseAppliedAt" TIMESTAMP(3),
ADD COLUMN     "renewalIncreaseMode" "RenewalIncreaseMode" NOT NULL DEFAULT 'EVERY_RENEWAL',
ADD COLUMN     "renewalIncreasePercentOverride" INTEGER;
