import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * Root: instrada in base alla sessione. Il middleware copre già il caso
 * "non autenticato", qui gestiamo l'ingresso autenticato verso la dashboard.
 */
export default async function HomePage() {
  const session = await getSession();
  redirect(session ? "/dashboard" : "/login");
}
