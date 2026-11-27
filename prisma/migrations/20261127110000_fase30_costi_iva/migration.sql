-- Fase 30: IVA dei costi (22 = IVA inclusa, 0 = esente). I costi già inseriti
-- sono considerati IVA inclusa: quelli esenti vanno corretti dalla dashboard.
ALTER TABLE "costs" ADD COLUMN "vatPercent" INTEGER NOT NULL DEFAULT 22;
