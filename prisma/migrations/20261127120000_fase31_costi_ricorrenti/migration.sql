-- Fase 31: costi ricorrenti (rinnovo automatico della data) e avviso rinnovi.
ALTER TYPE "EmailLogType" ADD VALUE 'COST_RENEWAL_ALERT';
ALTER TABLE "costs" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false;
