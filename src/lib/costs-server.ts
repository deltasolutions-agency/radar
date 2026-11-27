import "server-only";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/cron/common";
import { annualCostCents, annualItemRevenueCents, resolveShares, toNumber } from "@/lib/costs";

export type SubscriptionMargin = {
  id: string;
  label: string;
  revenueCents: number; // ricavo annuo (righe non cessate)
  costCents: number; // quota annua dei costi richiamati
  marginCents: number;
  allocations: {
    id: string;
    costId: string;
    costName: string;
    supplier: string | null;
    sharedWith: number; // abbonamenti che richiamano lo stesso costo
    effectivePercent: number;
    annualShareCents: number;
  }[];
};

export type CostSummary = {
  id: string;
  annualCents: number;
  subscriptions: number;
  /** Quota annua per abbonamento (parti uguali); null se non richiamato. */
  perSubscriptionCents: number | null;
};

/** Etichetta leggibile di un abbonamento: cliente · servizi. */
export function subscriptionLabel(clientName: string, serviceNames: string[]): string {
  const names = [...new Set(serviceNames)];
  const services = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  return services ? `${clientName} · ${services}` : clientName;
}

/**
 * Costi in uso e quote annue per abbonamento. Un costo richiamato da N
 * abbonamenti si divide in N parti uguali (salvo quote fissate a mano, non più
 * esposte nell'interfaccia ma ancora rispettate se presenti).
 */
export async function loadMargins(): Promise<{
  subscriptions: Map<string, SubscriptionMargin>;
  costs: Map<string, CostSummary>;
}> {
  const [subs, costs] = await Promise.all([
    prisma.subscription.findMany({
      where: { activationState: { not: "CANCELLED_BEFORE_START" } },
      select: {
        id: true,
        client: { select: { name: true, ragioneSociale: true } },
        items: {
          select: {
            priceCents: true,
            quantity: true,
            billingPeriod: true,
            customPeriodDays: true,
            status: true,
            service: { select: { name: true } },
          },
        },
      },
    }),
    prisma.cost.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        supplier: true,
        amountCents: true,
        periodMonths: true,
        vatPercent: true,
        allocations: { select: { id: true, subscriptionId: true, sharePercent: true } },
      },
    }),
  ]);

  const bySub = new Map<string, SubscriptionMargin>();
  for (const s of subs) {
    bySub.set(s.id, {
      id: s.id,
      label: subscriptionLabel(clientDisplayName(s.client), s.items.map((it) => it.service.name)),
      revenueCents: s.items.reduce((sum, it) => sum + annualItemRevenueCents(it), 0),
      costCents: 0,
      marginCents: 0,
      allocations: [],
    });
  }

  const costSummaries = new Map<string, CostSummary>();
  for (const c of costs) {
    const annual = annualCostCents(c.amountCents, c.periodMonths, c.vatPercent);
    const allocs = c.allocations.map((a) => ({ ...a, sharePercent: toNumber(a.sharePercent) }));
    const { shares } = resolveShares(allocs);
    for (const a of allocs) {
      const sub = bySub.get(a.subscriptionId);
      if (!sub) continue; // abbonamento annullato prima di partire
      const pct = shares.get(a.id) ?? 0;
      const annualShareCents = Math.round((annual * pct) / 100);
      sub.costCents += annualShareCents;
      sub.allocations.push({
        id: a.id,
        costId: c.id,
        costName: c.name,
        supplier: c.supplier,
        sharedWith: allocs.length,
        effectivePercent: pct,
        annualShareCents,
      });
    }
    costSummaries.set(c.id, {
      id: c.id,
      annualCents: annual,
      subscriptions: allocs.length,
      perSubscriptionCents: allocs.length ? Math.round(annual / allocs.length) : null,
    });
  }

  for (const s of bySub.values()) s.marginCents = s.revenueCents - s.costCents;
  return { subscriptions: bySub, costs: costSummaries };
}
