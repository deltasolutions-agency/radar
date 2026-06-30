import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seed: crea (o aggiorna) l'utente admin iniziale a partire dalle variabili
 * d'ambiente ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 *
 * È idempotente: rilanciarlo non duplica l'admin. La password viene
 * (re)impostata solo a partire da ADMIN_PASSWORD, così il seed può anche
 * servire a resettarla in sviluppo.
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Delta Admin";

  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL e ADMIN_PASSWORD sono richiesti per il seed. " +
        "Impostali nel file .env.",
    );
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD deve essere lunga almeno 8 caratteri.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, role: "ADMIN" },
    create: { email, passwordHash, name, role: "ADMIN" },
  });

  console.log(`✓ Admin pronto: ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error("Seed fallito:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
