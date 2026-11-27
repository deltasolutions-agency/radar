-- Fase 33: quantità sul collegamento costo-abbonamento (es. 2 siti sullo stesso hosting).
ALTER TABLE "cost_allocations" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
