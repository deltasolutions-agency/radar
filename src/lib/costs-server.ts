import "server-only";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/cron/common";
import {
  annualCostCents,
  annualItemRevenueCents,
  resolveShares,
  toNumber,
} from "@/lib/costs";

export type SubscriptionMargin = {
  id: string;
  label: string;
  clientName: string;
  revenueCents: number; // ricavo annuo (righe non cessate)
  catalogCostCents: number; // costo fornitore dal listino servizi (Service.costCents)
  allocatedCostCents: number; // quota annua dei costi collegati
  marginCents: number;
  allocations: {
    id: string;
    costId: string;
    costName: string;
    sharePercent: number | null; // fissata (null = parti uguali)
    effectivePercent: number;
    annualShareCents: number;
  }[];
};

export type CostSummary = {
  id: string;
  annualCents: number;
  allocatedPercent: number;
  unassignedPercent: number;
  subscriptions: number;
};

/** Etichetta leggibile di un abbonamento: cliente · servizi. */
export function subscriptionLabel(clientName: string, serviceNames: string[]): string {
  const names = [...new Set(serviceNames)];
  const services = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  return services ? `${clientName} · ${services}` : clientName;
}

/**
 * Margini annui di tutti gli abbonamenti (esclusi quelli annullati prima di
 * partire) e riepilogo dei costi in uso. Calcolo in memoria: i volumi di Radar
 * (decine/centinaia di abbonamenti) lo permettono senza problemi.
 */
export async function loadMargins(): Promise<{
  subscriptions: SubscriptionMargin[];
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
            service: { select: { name: true, costCents: true } },
          },
        },
      },
    }),
    prisma.cost.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        amountCents: true,
        periodMonths: true,
        allocations: { select: { id: true, subscriptionId: true, sharePercent: true } },
      },
    }),
  ]);

  const bySub = new Map<string, SubscriptionMargin>();
  for (const s of subs) {
    const clientName = clientDisplayName(s.client);
    const live = s.items.filter((it) => it.status !== "CESSATO");
    const revenueCents = live.reduce((sum, it) => sum + annualItemRevenueCents(it), 0);
    // Il costo di listino segue la periodicità della riga, come il prezzo.
    const catalogCostCents = live.reduce(
      (sum, it) =>
        sum +
        annualItemRevenueCents({ ...it, priceCents: it.service.costCents }),
      0,
    );
    bySub.set(s.id, {
      id: s.id,
      label: subscriptionLabel(clientName, s.items.map((it) => it.service.name)),
      clientName,
      revenueCents,
      catalogCostCents,
      allocatedCostCents: 0,
      marginCents: 0,
      allocations: [],
    });
  }

  const costSummaries = new Map<string, CostSummary>();
  for (const c of costs) {
    const annual = annualCostCents(c.amountCents, c.periodMonths);
    const allocs = c.allocations.map((a) => ({ ...a, sharePercent: toNumber(a.sharePercent) }));
    const { shares, unassignedPercent } = resolveShares(allocs);
    for (const a of allocs) {
      const sub = bySub.get(a.subscriptionId);
      if (!sub) continue; // abbonamento annullato prima di partire
      const pct = shares.get(a.id) ?? 0;
      const annualShareCents = Math.round((annual * pct) / 100);
      sub.allocatedCostCents += annualShareCents;
      sub.allocations.push({
        id: a.id,
        costId: c.id,
        costName: c.name,
        sharePercent: a.sharePercent,
        effectivePercent: pct,
        annualShareCents,
      });
    }
    costSummaries.set(c.id, {
      id: c.id,
      annualCents: annual,
      allocatedPercent: 100 - unassignedPercent,
      unassignedPercent,
      subscriptions: allocs.length,
    });
  }

  for (const s of bySub.values()) {
    s.marginCents = s.revenueCents - s.catalogCostCents - s.allocatedCostCents;
  }
  return { subscriptions: [...bySub.values()], costs: costSummaries };
}
