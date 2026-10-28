/**
 * Badge "EN" per i clienti con comunicazioni in inglese (nessun badge per
 * l'italiano, che è il default). Stile coerente con ServiceTypeBadge.
 */
export function LocaleBadge({ locale }: { locale: string | null | undefined }) {
  if (locale !== "EN") return null;
  return (
    <span
      title="Comunicazioni in inglese"
      className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-sky-700"
    >
      EN
    </span>
  );
}
