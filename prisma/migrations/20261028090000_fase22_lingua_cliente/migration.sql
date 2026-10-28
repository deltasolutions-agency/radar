-- Fase 22 — Lingua delle comunicazioni per cliente (IT/EN).
-- Migration scritta a mano: NON elimina né ricrea tabelle, le righe esistenti
-- restano tutte in italiano (locale = 'IT').

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('IT', 'EN');

-- AlterTable: lingua del cliente (default italiano per tutti i clienti esistenti)
ALTER TABLE "clients" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'IT';

-- AlterTable: lingua in cui il testo legale è stato mostrato al momento del consenso
ALTER TABLE "consent_logs" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'IT';

-- AlterTable: traduzioni opzionali dei servizi
ALTER TABLE "services" ADD COLUMN "nameEn" TEXT,
ADD COLUMN "descriptionEn" TEXT;

-- AlterTable: testi reminder per tipo E lingua.
-- Le righe esistenti diventano le versioni italiane (locale = 'IT').
ALTER TABLE "reminder_templates" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'IT';
ALTER TABLE "reminder_templates" DROP CONSTRAINT "reminder_templates_pkey";
ALTER TABLE "reminder_templates" ADD CONSTRAINT "reminder_templates_pkey" PRIMARY KEY ("type", "locale");
