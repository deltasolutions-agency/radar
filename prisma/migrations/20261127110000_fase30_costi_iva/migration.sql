-- Fase 30: IVA dei costi. 0 = esente / senza IVA (default, anche per i costi
-- già inseriti), 22 = IVA inclusa e detraibile (scorporata nei margini).
ALTER TABLE "costs" ADD COLUMN "vatPercent" INTEGER NOT NULL DEFAULT 0;
