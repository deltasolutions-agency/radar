import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { romeYmd } from "@/lib/rome-time";
import { dayFromYmd } from "@/lib/ledger";

// Barra delle sezioni di Amministrazione: Incassi, Dovuto, Costi, Pagamenti.
// Il pallino rosso su Incassi/Dovuto conta le voci aperte oltre la scadenza.

const TABS = [
  { slug: "incassi", label: "Incassi", href: "/amministrazione/incassi" },
  { slug: "dovuto", label: "Dovuto", href: "/amministrazione/dovuto" },
  { slug: "costi", label: "Costi", href: "/amministrazione/costi" },
  { slug: "pagamenti", label: "Pagamenti", href: "/amministrazione/pagamenti" },
] as const;
export type AdminTabSlug = (typeof TABS)[number]["slug"];

export async function AdminTabs({ active }: { active: AdminTabSlug }) {
  const today = dayFromYmd(romeYmd(new Date()));
  const overdue = await prisma.ledgerEntry.groupBy({
    by: ["kind"],
    where: { paidAt: null, dueDate: { lt: today } },
    _count: true,
  });
  const count = (kind: "CREDITO" | "DEBITO") => overdue.find((o) => o.kind === kind)?._count ?? 0;
  const badges: Partial<Record<AdminTabSlug, number>> = { incassi: count("CREDITO"), dovuto: count("DEBITO") };

  return (
    <nav aria-label="Sezioni di Amministrazione" className="flex gap-1 overflow-x-auto border-b border-line text-sm">
      {TABS.map((t) => {
        const n = badges[t.slug] ?? 0;
        return (
          <Link
            key={t.slug}
            href={t.href}
            aria-current={t.slug === active ? "page" : undefined}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 font-medium transition ${
              t.slug === active ? "border-brand text-ink" : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {t.label}
            {n > 0 ? (
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 font-mono text-[11px] leading-5 text-white"
                title={`${n} scadut${n === 1 ? "o" : "i"}`}
              >
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
