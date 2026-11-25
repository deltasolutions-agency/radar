-- Fase 26: rinnovi mensili sempre lo stesso giorno del mese (abbonamenti della console Delta Cloud)
ALTER TABLE "subscription_items" ADD COLUMN "calendarAnchorDay" INTEGER;
