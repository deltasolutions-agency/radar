import { tr, type Lang } from "@/lib/i18n";

/** Sottotitolo "Cliente finale: X" sotto il nome di un servizio (Space Mono). */
export function EndClientLabel({
  name,
  className = "",
  lang = "it",
}: {
  name: string | null | undefined;
  className?: string;
  lang?: Lang;
}) {
  if (!name) return null;
  return (
    <span className={`block font-mono text-xs text-slate-500 ${className}`}>
      {tr(lang, { it: "Cliente finale", en: "End client" })}: {name}
    </span>
  );
}
