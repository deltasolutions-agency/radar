import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ServiziTable } from "./servizi-table";
import {
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  type ServiceTypeValue,
} from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function ServiziPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const type =
    searchParams.type &&
    SERVICE_TYPES.includes(searchParams.type as ServiceTypeValue)
      ? (searchParams.type as ServiceTypeValue)
      : undefined;

  const services = await prisma.service.findMany({
    where: type ? { type } : undefined,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servizi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Catalogo riusabile · {services.length}{" "}
            {services.length === 1 ? "servizio" : "servizi"}
            {type ? ` · ${SERVICE_TYPE_LABELS[type]}` : ""}
          </p>
        </div>
        <Link href="/servizi/nuovo" className="btn-primary">
          + Nuovo servizio
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/servizi"
          className={!type ? "btn-primary" : "btn-ghost"}
        >
          Tutti
        </Link>
        {SERVICE_TYPES.map((t) => (
          <Link
            key={t}
            href={`/servizi?type=${t}`}
            className={type === t ? "btn-primary" : "btn-ghost"}
          >
            {SERVICE_TYPE_LABELS[t]}
          </Link>
        ))}
      </div>

      <ServiziTable services={services} />
    </div>
  );
}
