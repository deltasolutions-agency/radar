import { redirect } from "next/navigation";

// Pagamenti è ora una sezione di Amministrazione: i vecchi link (segnalibri,
// email) continuano a funzionare, filtri compresi.
export default function PagamentiRedirect({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") p.set(k, v);
  }
  const q = p.toString();
  redirect(`/amministrazione/pagamenti${q ? `?${q}` : ""}`);
}
