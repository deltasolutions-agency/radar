// Analisi di SOLA LETTURA: impatto dell'allineamento di EVERY_RENEWAL alla
// logica di ONCE (l'aumento si paga GIÀ al rinnovo, non dal periodo successivo).
//
//   npx tsx scripts/renewal-impact.ts            # righe non cessate
//   npx tsx scripts/renewal-impact.ts --all      # include anche CESSATO
//   npx tsx scripts/renewal-impact.ts --csv      # output CSV (separatore ;)
//
// Elenca le righe EVERY_RENEWAL con % di aumento effettiva > 0 (servizio o
// override) e confronta il netto del prossimo rinnovo OGGI (prezzo corrente)
// con quello DOPO l'allineamento (prezzo corrente × (1 + %)). Esegue solo
// SELECT: non scrive sul DB, non invia email, non chiama Stripe.
import "./script-env";
import { prisma } from "@/lib/prisma";
import { withEndClient } from "@/lib/end-client";
import { clientDisplayName, serviceLabel } from "@/lib/cron/common";
import {
  applyIncrease,
  effectiveIncreasePercent,
} from "@/lib/renewal-price";

const args = process.argv.slice(2);
const includeCeased = args.includes("--all");
const csv = args.includes("--csv");

const money = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
const date = (d: Date) => d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });

async function main() {
  const items = await prisma.subscriptionItem.findMany({
    where: {
      renewalIncreaseMode: "EVERY_RENEWAL",
      ...(includeCeased ? {} : { status: { not: "CESSATO" } }),
      OR: [
        { renewalIncreasePercentOverride: { gt: 0 } },
        {
          renewalIncreasePercentOverride: null,
          service: { renewalIncreasePercent: { gt: 0 } },
        },
      ],
    },
    include: {
      service: { select: { name: true, renewalIncreasePercent: true } },
      subscription: {
        select: { id: true, client: { select: { name: true, ragioneSociale: true } } },
      },
      paymentItems: {
        where: { status: { in: ["CONFERMATO", "IN_ATTESA"] } },
        select: {
          status: true,
          previousPriceCents: true,
          createdAt: true,
          payment: { select: { method: true, linkSentAt: true, checkoutExpiresAt: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const rows = items
    .map((it) => {
      const pct = effectiveIncreasePercent(it);
      // Logica precedente all'allineamento: EVERY_RENEWAL pagava il prezzo corrente.
      const todayUnit = it.priceCents;
      const afterUnit = applyIncrease(it.priceCents, pct);
      const confirmed = it.paymentItems.filter((p) => p.status === "CONFERMATO");
      // Rinnovo confermato che ha già alzato il prezzo con la logica attuale:
      // l'aumento è già incorporato nel prezzo corrente.
      const pastIncrease = confirmed.some(
        (p) => p.previousPriceCents != null && p.previousPriceCents < it.priceCents,
      );
      const pending = it.paymentItems.filter((p) => p.status === "IN_ATTESA");
      return {
        client: clientDisplayName(it.subscription.client),
        service: serviceLabel(it),
        endClient: it.endClientName ?? "",
        label: withEndClient(serviceLabel(it), it.endClientName),
        subscriptionId: it.subscriptionId,
        itemId: it.id,
        status: it.status,
        endDate: it.endDate,
        currency: it.currency,
        quantity: it.quantity,
        pct,
        pctSource: it.renewalIncreasePercentOverride != null ? "override" : "servizio",
        currentUnit: it.priceCents,
        todayUnit,
        afterUnit,
        todayLine: todayUnit * it.quantity,
        afterLine: afterUnit * it.quantity,
        renewals: confirmed.length,
        lastRenewalAt: it.lastRenewalAt,
        pastIncrease,
        pendingPayments: pending.length,
        autoCharge: it.autoChargeEnabled,
      };
    })
    .sort(
      (a, b) =>
        a.client.localeCompare(b.client, "it") || a.endDate.getTime() - b.endDate.getTime(),
    );

  if (csv) {
    const head = [
      "cliente", "servizio", "cliente_finale", "stato", "scadenza", "quantita",
      "perc", "fonte_perc", "prezzo_attuale_unit", "prossimo_oggi_unit",
      "prossimo_dopo_unit", "prossimo_oggi_riga", "prossimo_dopo_riga",
      "differenza_riga", "rinnovi_confermati", "aumento_gia_incorporato",
      "pagamenti_in_attesa", "rinnovo_automatico", "subscription_id", "item_id",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    console.log(head.join(";"));
    for (const r of rows) {
      console.log(
        [
          r.client, r.service, r.endClient, r.status, date(r.endDate), r.quantity,
          r.pct, r.pctSource, eur(r.currentUnit), eur(r.todayUnit), eur(r.afterUnit),
          eur(r.todayLine), eur(r.afterLine), eur(r.afterLine - r.todayLine),
          r.renewals, r.pastIncrease ? "si" : "no", r.pendingPayments,
          r.autoCharge ? "si" : "no", r.subscriptionId, r.itemId,
        ].map(esc).join(";"),
      );
    }
    return;
  }

  console.log(
    `Righe EVERY_RENEWAL con aumento > 0${includeCeased ? " (incluse CESSATO)" : " (escluse CESSATO)"}: ${rows.length}`,
  );
  console.log("Importi NETTI (IVA e costo di servizio esclusi).\n");

  let currentClient = "";
  for (const r of rows) {
    if (r.client !== currentClient) {
      currentClient = r.client;
      console.log(`▸ ${r.client}`);
    }
    const qty = r.quantity > 1 ? ` (×${r.quantity}: ${money(r.todayLine, r.currency)} → ${money(r.afterLine, r.currency)})` : "";
    console.log(
      `  - ${r.label} · scadenza ${date(r.endDate)} · stato ${r.status} · +${r.pct}% (${r.pctSource})`,
    );
    console.log(
      `      prezzo attuale ${money(r.currentUnit, r.currency)} · prossimo rinnovo OGGI ${money(r.todayUnit, r.currency)} · ` +
        `DOPO ${money(r.afterUnit, r.currency)}${qty}`,
    );
    const notes: string[] = [];
    notes.push(
      r.renewals > 0
        ? `${r.renewals} rinnovi confermati, ultimo ${r.lastRenewalAt ? date(r.lastRenewalAt) : "—"}`
        : "mai rinnovata",
    );
    if (r.pastIncrease) {
      notes.push("⚠ aumento storico già nel prezzo attuale: dopo l'allineamento al prossimo rinnovo scatta un ulteriore +%");
    }
    if (r.pendingPayments > 0) {
      notes.push(`⚠ ${r.pendingPayments} pagamento/i IN_ATTESA già creati al prezzo attuale`);
    }
    if (r.autoCharge) notes.push("rinnovo automatico attivo");
    console.log(`      ${notes.join(" · ")}`);
  }

  // ── Riepilogo ────────────────────────────────────────────────────────────
  const byCurrency = new Map<string, { today: number; after: number }>();
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { today: 0, after: 0 };
    t.today += r.todayLine;
    t.after += r.afterLine;
    byCurrency.set(r.currency, t);
  }
  console.log(`\n${"═".repeat(78)}\nRiepilogo\n${"═".repeat(78)}`);
  console.log(`  righe coinvolte:                         ${rows.length}`);
  console.log(`    mai rinnovate:                         ${rows.filter((r) => r.renewals === 0).length}`);
  console.log(`    con aumento storico già nel prezzo:    ${rows.filter((r) => r.pastIncrease).length}`);
  console.log(`    con pagamenti IN_ATTESA:               ${rows.filter((r) => r.pendingPayments > 0).length}`);
  console.log(`    con rinnovo automatico:                ${rows.filter((r) => r.autoCharge).length}`);
  for (const [cur, t] of byCurrency) {
    console.log(
      `  prossimi rinnovi (${cur.toUpperCase()}): oggi ${money(t.today, cur)} → dopo ${money(t.after, cur)} (+${money(t.after - t.today, cur)})`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
