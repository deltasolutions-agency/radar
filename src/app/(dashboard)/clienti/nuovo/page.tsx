import Link from "next/link";
import { ClientForm } from "../client-form";

export default function NuovoClientePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/clienti" className="text-sm text-slate-500 hover:underline">
          ← Clienti
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Nuovo cliente
        </h1>
      </div>
      <ClientForm mode="create" />
    </div>
  );
}
