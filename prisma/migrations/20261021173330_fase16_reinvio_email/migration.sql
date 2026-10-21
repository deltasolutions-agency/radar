-- AlterTable
ALTER TABLE "email_logs" ADD COLUMN     "resentFromId" TEXT;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_resentFromId_fkey" FOREIGN KEY ("resentFromId") REFERENCES "email_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
