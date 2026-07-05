-- AlterTable
ALTER TABLE "subscription_items" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "serviceFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
