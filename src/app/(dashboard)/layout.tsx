import { getSession } from "@/lib/auth";
import { logoutAction } from "./actions";
import { Nav } from "./nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Il middleware garantisce già la sessione; qui la usiamo per la testata.
  const session = await getSession();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="leading-tight">
              <span className="text-base font-semibold">Radar</span>
              <span className="mono-label ml-2">Delta Solutions</span>
            </div>
            <Nav />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {session?.name ?? session?.email}
            </span>
            <form action={logoutAction}>
              <button type="submit" className="btn-ghost">
                Esci
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
