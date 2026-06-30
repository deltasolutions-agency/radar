import { SignJWT, jwtVerify } from "jose";

/**
 * Gestione delle sessioni staff basata su JWT firmati (jose).
 *
 * Questo modulo è volutamente "edge-safe": importa solo `jose` e legge
 * `process.env`, così può essere usato dal middleware (Edge runtime) oltre
 * che dai Server Component / Server Action. NON importare qui Prisma o
 * bcryptjs, che non sono compatibili con l'Edge runtime.
 */

export const SESSION_COOKIE = "radar_session";

/** Durata della sessione: 7 giorni. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string; // id utente
  email: string;
  role: string;
  name?: string | null;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET mancante o troppo corto (min 16 caratteri).",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Firma un token di sessione con scadenza. */
export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    name: payload.name ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());
}

/** Verifica un token e restituisce il payload, oppure null se non valido. */
export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: typeof payload.role === "string" ? payload.role : "ADMIN",
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch {
    return null;
  }
}
