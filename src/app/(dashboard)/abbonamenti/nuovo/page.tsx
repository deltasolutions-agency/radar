import Link from "next/link";
import { SubscriptionForm } from "../subscription-form";

export default function NuovoAbbonamentoPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/abbonamenti"
          className="text-sm text-slate-500 hover:underline"
        >
          ← Abbonamenti
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Nuovo abbonamento
        </h1>
      </div>
      <SubscriptionForm mode="create" />
    </div>
  );
}
