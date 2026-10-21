/** Sottotitolo "Cliente finale: X" sotto il nome di un servizio (Space Mono). */
export function EndClientLabel({
  name,
  className = "",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) return null;
  return (
    <span className={`block font-mono text-xs text-slate-500 ${className}`}>
      Cliente finale: {name}
    </span>
  );
}
