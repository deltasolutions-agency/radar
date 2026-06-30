import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const [clientCount, serviceCount, activeServiceCount] = await Promise.all([
    prisma.client.count(),
    prisma.service.count(),
    prisma.service.count({ where: { active: true } }),
  ]);

  const cards = [
    { label: "Clienti", value: clientCount, href: "/clienti" },
    {
      label: "Servizi a catalogo",
      value: serviceCount,
      href: "/servizi",
      hint: `${activeServiceCount} attivi`,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Panoramica anagrafiche e catalogo. Abbonamenti e scadenze in arrivo
          nella Fase 4.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card p-6 transition hover:shadow-sm">
            <div className="mono-label">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold">{c.value}</div>
            {c.hint ? (
              <div className="mt-1 text-xs text-slate-500">{c.hint}</div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
