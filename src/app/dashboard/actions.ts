"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";

/** Logout: cancella il cookie di sessione e torna al login. */
export async function logoutAction(): Promise<void> {
  destroySession();
  redirect("/login");
}
