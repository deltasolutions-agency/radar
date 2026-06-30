import { PrismaClient } from "@prisma/client";

/**
 * Singleton del client Prisma.
 *
 * In sviluppo Next.js ricarica i moduli a ogni hot-reload: senza singleton
 * si accumulerebbero connessioni al database. Riusiamo l'istanza tramite
 * globalThis.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
