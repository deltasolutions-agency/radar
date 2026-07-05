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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png"
                alt="Delta Solutions"
                className="h-7 w-auto"
              />
              <div className="leading-tight">
                <span className="text-base font-semibold">Radar</span>
                <span className="mono-label ml-2 hidden sm:inline">
                  Delta Solutions
                </span>
              </div>
            </div>
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
          {/* Nav: a capo su mobile, scorrevole in orizzontale se necessario. */}
          <div className="order-last -mx-4 w-full overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
            <Nav />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
