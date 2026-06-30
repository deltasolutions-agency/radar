import { z } from "zod";

/**
 * Validazione centralizzata delle variabili d'ambiente lato server.
 *
 * Le chiavi di terze parti (Stripe, Resend) sono opzionali in questa fase:
 * verranno rese obbligatorie quando i rispettivi moduli entreranno in uso
 * (Fase pagamenti / notifiche). AUTH_SECRET è invece richiesto da subito.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Autenticazione staff: chiave di firma delle sessioni JWT.
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET deve essere lungo almeno 16 caratteri"),

  // Admin iniziale (usato solo dal seed).
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().optional(),

  // Stripe (opzionali finché il modulo pagamenti non è attivo).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Resend (opzionali finché il modulo notifiche non è attivo).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Protezione endpoint cron.
  CRON_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variabili d'ambiente non valide o mancanti:\n${issues}\n` +
      `Controlla il file .env (vedi .env.example).`,
  );
}

export const env = parsed.data;
export type Env = typeof env;
