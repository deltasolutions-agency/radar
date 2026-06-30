"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, createSession } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Email non valida"),
  password: z.string().min(1, "Inserisci la password"),
  next: z.string().optional(),
});

export type LoginState = {
  error?: string;
};

/** Action del form di login (usata con useFormState). */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }

  const session = await authenticate(parsed.data.email, parsed.data.password);
  if (!session) {
    return { error: "Credenziali non valide" };
  }

  await createSession(session);

  // Reindirizza solo verso percorsi interni (evita open-redirect).
  const next = parsed.data.next;
  const dest = next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/dashboard";

  // redirect() lancia un'eccezione di controllo: deve stare fuori da try/catch.
  redirect(dest);
}
