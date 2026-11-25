-- Fase 25: abbonamenti della console Delta Cloud (benvenuto al primo pagamento, carta obbligatoria)
ALTER TABLE "subscriptions" ADD COLUMN "consoleManaged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "requireAutoCharge" BOOLEAN NOT NULL DEFAULT false;
