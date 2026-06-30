import { getSession } from "@/lib/auth";
import { logoutAction } from "./actions";

export default async function DashboardPage() {
  // Il middleware garantisce già la presenza di una sessione valida.
  const session = await getSession();

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">Radar</h1>
            <p className="text-xs text-slate-500">Delta Solutions</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              {session?.name ?? session?.email}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition hover:bg-slate-100"
              >
                Esci
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <h2 className="text-xl font-semibold">Benvenuto in Radar</h2>
          <p className="mt-2 text-sm text-slate-600">
            Infrastruttura e autenticazione attive. I moduli Clienti, Servizi,
            Abbonamenti e Scadenze arriveranno nelle prossime fasi.
          </p>
        </div>
      </div>
    </main>
  );
}
