-- Fase 35: costi usabili più volte dallo stesso cliente (quantità − / +).
ALTER TABLE "costs" ADD COLUMN "multiUse" BOOLEAN NOT NULL DEFAULT false;
-- I costi già richiamati più volte restano multiuso, così le quantità non si perdono.
UPDATE "costs" SET "multiUse" = true
WHERE "id" IN (SELECT DISTINCT "costId" FROM "cost_allocations" WHERE "quantity" > 1);
