// Migrazione una tantum per l'allineamento di EVERY_RENEWAL a ONCE (l'aumento
// si paga GIÀ al rinnovo). Da lanciare DOPO il deploy del nuovo calcolo.
//
//   npx tsx scripts/renewal-align-migrate.ts           # dry-run (default)
//   npx tsx scripts/renewal-align-migrate.ts --apply   # salva
//   npx tsx scripts/renewal-align-migrate.ts --all     # include anche CESSATO
//
// Con la logica precedente, alla conferma di un rinnovo EVERY_RENEWAL si pagava
// il prezzo corrente e il prezzo saliva subito per il periodo SUCCESSIVO: le
// righe già rinnovate hanno l'aumento già incorporato. Con la logica nuova
// pagherebbero un secondo aumento di fila. Per queste righe il prezzo corrente
// torna all'ultimo prezzo pagato (PaymentItem.previousPriceCents dell'ultimo
// rinnovo confermato), così il prossimo rinnovo resta identico a quello che
// avrebbero pagato prima dell'allineamento.
//
// Una riga viene modificata SOLO se:
//   - prezzo attuale == round(ultimo pagato × (1 + %)) (aumento automatico
//     non ritoccato a mano), e
//   - l'ultimo rinnovo è stato pagato al prezzo precedente (logica vecchia):
//     un rinnovo confermato col nuovo calcolo è già allineato.
// Altrimenti finisce nell'elenco "controllo manuale" e non viene toccata.
//
// Idempotente: ogni riga migrata ha un AdminActionLog RENEWAL_ALIGN_MIGRATE e
// viene saltata ai lanci successivi (anche dopo nuovi rinnovi).
import "./script-env";
import { prisma } from "@/lib/prisma";
import { withEndClient } from "@/lib/end-client";
import { clientDisplayName, serviceLabel } from "@/lib/cron/common";
import { addVatToNet } from "@/lib/vat";
import {
  applyIncrease,
  effectiveIncreasePercent,
  renewalChargePriceCents,
} from "@/lib/renewal-price";

const ACTION = "RENEWAL_ALIGN_MIGRATE";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeCeased = args.includes("--all");

const money = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
const date = (d: Date) => d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });

type Planned = {
  itemId: string;
  label: string;
  client: string;
  status: string;
  endDate: Date;
  currency: string;
  quantity: number;
  pct: number;
  currentCents: number;
  lastPaidCents: number;
  newCents: number;
  /** Prossimo rinnovo con la logica precedente (= prezzo attuale). */
  nextBeforeCents: number;
  /** Prossimo rinnovo con la logica nuova DOPO la migrazione. */
  nextAfterCents: number;
  paymentItemId: string;
  lastRenewalAt: Date | null;
};

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
      // Solo righe già rinnovate (almeno un rinnovo confermato con snapshot).
      paymentItems: { some: { status: "CONFERMATO", previousPriceCents: { not: null } } },
    },
    include: {
      service: { select: { name: true, renewalIncreasePercent: true } },
      subscription: { select: { client: { select: { name: true, ragioneSociale: true } } } },
      paymentItems: {
        where: { status: { in: ["CONFERMATO", "IN_ATTESA"] } },
        select: {
          id: true,
          status: true,
          amountCents: true,
          previousPriceCents: true,
          createdAt: true,
          payment: { select: { paidAt: true } },
        },
      },
    },
  });

  const migrated = new Set(
    (
      await prisma.adminActionLog.findMany({
        where: { action: ACTION, entityType: "SubscriptionItem" },
        select: { entityId: true },
      })
    ).map((l) => l.entityId),
  );

  const planned: Planned[] = [];
  const manual: { label: string; client: string; reason: string }[] = [];
  const alreadyDone: string[] = [];
  const alreadyAligned: string[] = [];
  const pendingWarnings: string[] = [];

  for (const it of items) {
    const label = withEndClient(serviceLabel(it), it.endClientName);
    const client = clientDisplayName(it.subscription.client);
    const full = `${client} · ${label}`;
    if (migrated.has(it.id)) {
      alreadyDone.push(full);
      continue;
    }
    const pct = effectiveIncreasePercent(it);
    // Ultimo rinnovo confermato (quello che ha fissato il prezzo attuale).
    const last = it.paymentItems
      .filter((p) => p.status === "CONFERMATO" && p.previousPriceCents != null)
      .sort(
        (a, b) =>
          (b.payment.paidAt ?? b.createdAt).getTime() - (a.payment.paidAt ?? a.createdAt).getTime() ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
    const lastPaid = last.previousPriceCents!;
    const expected = applyIncrease(lastPaid, pct);
    const paidNewLogic = last.amountCents === addVatToNet(it.priceCents * it.quantity).grossCents;
    const paidOldLogic = last.amountCents === addVatToNet(lastPaid * it.quantity).grossCents;

    if (it.paymentItems.some((p) => p.status === "IN_ATTESA")) {
      pendingWarnings.push(full);
    }
    if (paidNewLogic && !paidOldLogic) {
      alreadyAligned.push(full);
      continue;
    }
    if (it.priceCents !== expected) {
      manual.push({
        label,
        client,
        reason:
          `prezzo attuale ${money(it.priceCents, it.currency)} ≠ ultimo pagato ` +
          `${money(lastPaid, it.currency)} + ${pct}% = ${money(expected, it.currency)}`,
      });
      continue;
    }
    const after = { ...it, priceCents: lastPaid };
    planned.push({
      itemId: it.id,
      label,
      client,
      status: it.status,
      endDate: it.endDate,
      currency: it.currency,
      quantity: it.quantity,
      pct,
      currentCents: it.priceCents,
      lastPaidCents: lastPaid,
      newCents: lastPaid,
      nextBeforeCents: it.priceCents,
      nextAfterCents: renewalChargePriceCents(after),
      paymentItemId: last.id,
      lastRenewalAt: it.lastRenewalAt,
    });
  }

  planned.sort(
    (a, b) => a.client.localeCompare(b.client, "it") || a.endDate.getTime() - b.endDate.getTime(),
  );

  console.log(apply ? "MODALITÀ --apply: le modifiche vengono SALVATE.\n" : "DRY-RUN: nessuna modifica (usa --apply per salvare).\n");
  console.log(`Righe EVERY_RENEWAL già rinnovate con aumento > 0${includeCeased ? " (incluse CESSATO)" : " (escluse CESSATO)"}: ${items.length}`);
  console.log("Importi NETTI unitari.\n");

  console.log(`Da migrare: ${planned.length}`);
  for (const p of planned) {
    const same = p.nextAfterCents === p.nextBeforeCents;
    console.log(`  ▸ ${p.client} · ${p.label} · scadenza ${date(p.endDate)} · stato ${p.status} · +${p.pct}%`);
    console.log(
      `      prezzo attuale ${money(p.currentCents, p.currency)} · ultimo pagato ${money(p.lastPaidCents, p.currency)} · ` +
        `nuovo prezzo corrente ${money(p.newCents, p.currency)} · prossimo rinnovo ${money(p.nextAfterCents, p.currency)} ` +
        (same ? "(identico a oggi)" : `⚠ DIVERSO da oggi (${money(p.nextBeforeCents, p.currency)})`),
    );
  }

  if (manual.length > 0) {
    console.log(`\nControllo manuale (NESSUNA modifica): ${manual.length}`);
    for (const m of manual) console.log(`  - ${m.client} · ${m.label}: ${m.reason}`);
  }
  if (alreadyAligned.length > 0) {
    console.log(`\nUltimo rinnovo già pagato col nuovo calcolo (nessuna modifica): ${alreadyAligned.length}`);
    for (const s of alreadyAligned) console.log(`  - ${s}`);
  }
  if (alreadyDone.length > 0) {
    console.log(`\nGià migrate in precedenza (nessuna modifica): ${alreadyDone.length}`);
    for (const s of alreadyDone) console.log(`  - ${s}`);
  }
  if (pendingWarnings.length > 0) {
    console.log(`\n⚠ Righe con pagamenti IN_ATTESA (restano al prezzo del link): ${pendingWarnings.length}`);
    for (const s of pendingWarnings) console.log(`  - ${s}`);
  }

  if (!apply) {
    console.log(`\nDry-run completato: ${planned.length} righe verrebbero migrate.`);
    return;
  }
  if (planned.length === 0) {
    console.log("\nNulla da salvare.");
    return;
  }

  const userEmail = process.env.ADMIN_EMAIL ?? "script:renewal-align-migrate";
  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      // Aggiornamento condizionato al prezzo letto: se nel frattempo è
      // cambiato, l'intera transazione viene annullata.
      const res = await tx.subscriptionItem.updateMany({
        where: { id: p.itemId, priceCents: p.currentCents, renewalIncreaseMode: "EVERY_RENEWAL" },
        data: { priceCents: p.newCents },
      });
      if (res.count !== 1) {
        throw new Error(`Riga ${p.itemId} (${p.client} · ${p.label}) modificata nel frattempo: nessuna modifica salvata.`);
      }
      await tx.adminActionLog.create({
        data: {
          userEmail,
          action: ACTION,
          entityType: "SubscriptionItem",
          entityId: p.itemId,
          details: {
            before: { priceCents: p.currentCents },
            after: { priceCents: p.newCents },
            increasePercent: p.pct,
            lastPaidCents: p.lastPaidCents,
            lastPaymentItemId: p.paymentItemId,
            nextRenewalCents: p.nextAfterCents,
          },
        },
      });
    }
  });
  console.log(`\nSalvato: ${planned.length} righe migrate (AdminActionLog ${ACTION}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
