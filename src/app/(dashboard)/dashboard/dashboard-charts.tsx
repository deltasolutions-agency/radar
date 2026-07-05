"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatEur } from "@/lib/format";

// Colori coerenti con i badge di stato (badges.tsx), in tinta piena per i grafici.
const STATUS_COLORS: Record<string, string> = {
  ATTIVO: "#10b981",
  IN_SCADENZA: "#f97316",
  SCADUTO: "#ef4444",
  SOSPESO: "#eab308",
  RINNOVATO: "#3b82f6",
  CESSATO: "#94a3b8",
};

export type StatusDatum = { status: string; label: string; count: number };
export type MonthlyDatum = { month: string; totalCents: number };

/** Grafico a ciambella: distribuzione dei servizi per stato. */
export function StatusDonut({ data }: { data: StatusDatum[] }) {
  const nonZero = data.filter((d) => d.count > 0);
  const total = nonZero.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-slate-400">
        Nessun servizio da mostrare.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={nonZero}
          dataKey="count"
          nameKey="label"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {nonZero.map((d) => (
            <Cell
              key={d.status}
              fill={STATUS_COLORS[d.status] ?? "#94a3b8"}
              stroke="#ffffff"
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, _name, item) => {
            const n = Number(value);
            return [
              `${n} (${Math.round((n / total) * 100)}%)`,
              (item as { payload?: StatusDatum })?.payload?.label ?? "",
            ];
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) => (
            <span style={{ fontSize: 12, color: "#475569" }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Grafico a barre: incassi confermati per mese. */
export function IncomeBars({ data }: { data: MonthlyDatum[] }) {
  const hasData = data.some((d) => d.totalCents > 0);

  if (!hasData) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-slate-400">
        Nessun incasso confermato nel periodo.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickLine={false}
          axisLine={{ stroke: "#e2e8f0" }}
        />
        <YAxis
          tickFormatter={(v) => `${Math.round(Number(v) / 100)}`}
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          formatter={(value) => [formatEur(Number(value)), "Incassato"]}
          cursor={{ fill: "rgba(79,70,229,0.06)" }}
        />
        <Bar dataKey="totalCents" fill="#4f46e5" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
