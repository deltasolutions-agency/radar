import Link from "next/link";
import { ServiceForm } from "../service-form";

export default function NuovoServizioPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/servizi" className="text-sm text-slate-500 hover:underline">
          ← Servizi
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Nuovo servizio
        </h1>
      </div>
      <ServiceForm mode="create" />
    </div>
  );
}
