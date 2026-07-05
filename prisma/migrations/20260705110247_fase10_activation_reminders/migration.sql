-- AlterTable
ALTER TABLE "reminder_settings" ADD COLUMN     "autoChargeReminderHours" INTEGER[] DEFAULT ARRAY[12, 24]::INTEGER[];

-- CreateTable
CREATE TABLE "auto_charge_activation_reminders" (
    "id" TEXT NOT NULL,
    "autoChargeRequestId" TEXT NOT NULL,
    "hoursMark" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_charge_activation_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_charge_activation_reminders_autoChargeRequestId_hoursM_key" ON "auto_charge_activation_reminders"("autoChargeRequestId", "hoursMark");

-- AddForeignKey
ALTER TABLE "auto_charge_activation_reminders" ADD CONSTRAINT "auto_charge_activation_reminders_autoChargeRequestId_fkey" FOREIGN KEY ("autoChargeRequestId") REFERENCES "auto_charge_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
