import { getSession } from "@/lib/auth";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Il middleware garantisce già la sessione; qui la usiamo per la testata.
  const session = await getSession();
  const userLabel = session?.name ?? session?.email ?? "";

  return <DashboardShell userLabel={userLabel}>{children}</DashboardShell>;
}
