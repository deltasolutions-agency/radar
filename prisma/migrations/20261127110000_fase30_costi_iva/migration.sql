-- Fase 30: IVA dei costi e costi generali.
-- vatPercent: 0 = senza IVA (default, anche per i costi già inseriti),
-- 22 = IVA inclusa e detraibile (scorporata nei margini).
ALTER TABLE "costs" ADD COLUMN "vatPercent" INTEGER NOT NULL DEFAULT 0;
-- general: costo non legato ad abbonamenti, pesa solo sul margine complessivo.
ALTER TABLE "costs" ADD COLUMN "general" BOOLEAN NOT NULL DEFAULT false;
