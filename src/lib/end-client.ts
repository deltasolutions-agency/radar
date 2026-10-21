import { prisma } from "@/lib/prisma";

/**
 * Clienti finali distinti già usati sulle righe dei servizi di un cliente
 * (autocomplete nel form), in ordine alfabetico.
 */
export async function getEndClientSuggestions(clientId: string): Promise<string[]> {
  const rows = await prisma.subscriptionItem.findMany({
    where: { subscription: { clientId }, endClientName: { not: null } },
    distinct: ["endClientName"],
    select: { endClientName: true },
  });
  return rows
    .map((r) => r.endClientName)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "it"));
}

/** "Servizio – Cliente finale" (o solo il servizio se il cliente finale manca). */
export function withEndClient(serviceName: string, endClientName?: string | null): string {
  return endClientName ? `${serviceName} – ${endClientName}` : serviceName;
}

/**
 * Cliente finale comune a TUTTE le righe (per l'oggetto email), oppure null se
 * almeno una riga ne è priva o se i valori differiscono.
 */
export function commonEndClient(
  items: { endClientName?: string | null }[],
): string | null {
  if (items.length === 0) return null;
  const first = items[0].endClientName ?? null;
  if (!first) return null;
  return items.every((it) => it.endClientName === first) ? first : null;
}
