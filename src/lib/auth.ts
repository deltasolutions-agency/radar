import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/session";

/**
 * Logica di autenticazione lato Node (Server Component / Server Action).
 * Usa bcryptjs (hashing) e Prisma, quindi NON è importabile dal middleware.
 */

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Verifica le credenziali. Restituisce il payload di sessione se valide,
 * altrimenti null. Esegue sempre un confronto bcrypt (anche a utente
 * inesistente) per mitigare i timing attack sull'enumerazione email.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<SessionPayload | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // Hash fittizio per mantenere costante il tempo di risposta.
  const hash =
    user?.passwordHash ??
    "$2a$12$abcdefghijklmnopqrstuv0123456789012345678901234567890ab";

  const ok = await verifyPassword(password, hash);
  if (!user || !ok) return null;

  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };
}

/** Crea la sessione e imposta il cookie HttpOnly. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Rimuove il cookie di sessione (logout). */
export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

/** Legge e verifica la sessione corrente dai cookie. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
