import "server-only";
import { prisma } from "@/lib/prisma";
import { netCollectedCents } from "@/lib/payment-ledger";
import { splitVatFromGross } from "@/lib/vat";
import { addMonthsYmd, netCostCents } from "@/lib/costs";
import { loadMargins } from "@/lib/costs-server";

// Dati della dashboard per gli amministratori: entrate/uscite mese per mese
// con IVA a debito e a credito, e clienti sotto le soglie di margine.

export type FlowMonth = {
  month: string; // etichetta "nov 26"
  inCents: number; // entrate: incassi netti di storni, IVA inclusa
  outCents: number; // uscite: costi pagati nel mese, come inseriti
  vatDebitCents: number; // IVA sulle entrate
  vatCreditCents: number; // IVA detraibile sulle uscite
};

const MONTH_LABELS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/**
 * Ultimi `monthsBack` mesi. Le uscite sono una stima dai costi IN USO: ogni
 * costo si paga alla data di rinnovo e poi ogni `periodMonths` mesi (anche
 * all'indietro); i costi senza data di rinnovo si spalmano sui mesi.
 */
export async function loadCashFlow(now: Date, monthsBack = 12): Promise<FlowMonth[]> {
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  const months: FlowMonth[] = [];
  const index = new Map<string, number>();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    index.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
    months.push({
      month: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      inCents: 0,
      outCents: 0,
      vatDebitCents: 0,
      vatCreditCents: 0,
    });
  }

  const [payments, costs] = await Promise.all([
    prisma.payment.findMany({
      where: { status: { in: ["CONFERMATO", "RIMBORSATO"] }, paidAt: { gte: start } },
      select: {
        status: true,
        amountCents: true,
        serviceFeeCents: true,
        refundedServiceFeeCents: true,
        paidAt: true,
        items: { select: { status: true, amountCents: true } },
      },
    }),
    prisma.cost.findMany({
      where: { active: true },
      select: { amountCents: true, periodMonths: true, vatPercent: true, renewalDate: true },
    }),
  ]);

  for (const p of payments) {
    if (!p.paidAt) continue;
    const i = index.get(`${p.paidAt.getFullYear()}-${p.paidAt.getMonth()}`);
    if (i === undefined) continue;
    const net = netCollectedCents(p);
    // La commissione di servizio (solo carta) non ha IVA.
    const fee = Math.max(0, p.serviceFeeCents - p.refundedServiceFeeCents);
    months[i].inCents += net;
    months[i].vatDebitCents += splitVatFromGross(Math.max(0, net - fee)).vatCents;
  }

  const addOut = (i: number, amount: number, vatPercent: number) => {
    months[i].outCents += amount;
    months[i].vatCreditCents += amount - netCostCents(amount, vatPercent);
  };
  const firstYmd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  const lastYmd = (() => {
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
  })();
  for (const c of costs) {
    const period = Math.max(1, c.periodMonths);
    if (!c.renewalDate) {
      // Nessuna data: quota mensile su tutti i mesi.
      const monthly = Math.round(c.amountCents / period);
      months.forEach((_, i) => addOut(i, monthly, c.vatPercent));
      continue;
    }
    const anchor = c.renewalDate.toISOString().slice(0, 10);
    // Date di pagamento anchor + k·periodo che cadono nella finestra.
    for (let k = -Math.ceil(240 / period); k <= Math.ceil(240 / period); k++) {
      const d = addMonthsYmd(anchor, k * period);
      if (d < firstYmd || d > lastYmd) continue;
      const [y, m] = d.split("-").map(Number);
      const i = index.get(`${y}-${m - 1}`);
      if (i !== undefined) addOut(i, c.amountCents, c.vatPercent);
    }
  }
  return months;
}

export type ClientMargin = {
  clientId: string;
  clientName: string;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  /** null se non c'è ricavo (solo costi). */
  marginPercent: number | null;
};

/**
 * Margine annuo per cliente (somma dei suoi abbonamenti). Solo i clienti con
 * almeno un costo richiamato: senza costi il margine sarebbe sempre 100%.
 */
export async function loadClientMargins(): Promise<{ clients: ClientMargin[]; withoutCosts: number }> {
  const { subscriptions } = await loadMargins();
  const byClient = new Map<string, ClientMargin>();
  for (const s of subscriptions.values()) {
    const c = byClient.get(s.clientId) ?? {
      clientId: s.clientId,
      clientName: s.clientName,
      revenueCents: 0,
      costCents: 0,
      marginCents: 0,
      marginPercent: null,
    };
    c.revenueCents += s.revenueCents;
    c.costCents += s.costCents;
    byClient.set(s.clientId, c);
  }
  const all = [...byClient.values()].map((c) => ({
    ...c,
    marginCents: c.revenueCents - c.costCents,
    marginPercent: c.revenueCents > 0 ? ((c.revenueCents - c.costCents) / c.revenueCents) * 100 : null,
  }));
  const withCosts = all.filter((c) => c.costCents > 0);
  return { clients: withCosts, withoutCosts: all.length - withCosts.length };
}

export async function getDashboardSettings() {
  return (
    (await prisma.dashboardSettings.findUnique({ where: { id: "singleton" } })) ?? {
      marginWarnPercent: 75,
      marginAlertPercent: 60,
    }
  );
}
