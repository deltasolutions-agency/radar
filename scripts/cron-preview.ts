// Anteprima di SOLA LETTURA dei cron /api/cron/reminders e /api/cron/auto-charge.
//
//   npx tsx scripts/cron-preview.ts                       # riferimento: adesso
//   npx tsx scripts/cron-preview.ts --at=2026-10-22T08:00  # simula l'orario del cron
//   npx tsx scripts/cron-preview.ts --stripe              # + verifica carta (solo GET)
//
// Usa la STESSA selezione delle route (src/lib/cron/*-selection.ts) e gli stessi
// helper di calcolo importi (addVatToNet, computeServiceFeeCents). Non invia
// email, non scrive sul DB e non crea/modifica nulla su Stripe: con --stripe
// esegue solo paymentMethods.retrieve.
import "./script-env";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { computeItemStatus } from "@/lib/subscription-status";
import { addVatToNet } from "@/lib/vat";
import { computeServiceFeeCents } from "@/lib/service-fee";
import { MS_PER_DAY, periodDurationDays } from "@/lib/billing-period";
import {
  loadAutoChargeReminderHours,
  loadReminderThresholds,
} from "@/lib/reminder-settings";
import {
  BLOCKING,
  clientDisplayName,
  findPendingAutoChargeRequestToken,
  findReusablePaymentToken,
  hasNotificationLog,
  loadReminderItems,
  reminderDayKey,
  selectReminderAction,
  type ReminderItem,
} from "@/lib/cron/reminder-selection";
import {
  classifyAutoChargeCandidate,
  groupAutoChargeItems,
  loadAutoChargeCandidates,
  type EligibleItem,
} from "@/lib/cron/auto-charge-selection";

// ── Argomenti ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const atArg = args.find((a) => a.startsWith("--at="))?.slice(5);
const checkStripe = args.includes("--stripe");
const now = atArg ? new Date(atArg) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`--at non valido: ${atArg} (formato: YYYY-MM-DDTHH:MM, ora locale)`);
  process.exit(1);
}

// ── Formattazione ───────────────────────────────────────────────────────────
const money = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
const date = (d: Date) =>
  d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });
const dateTime = (d: Date) =>
  d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
const serviceLabel = (it: { quantity: number; service: { name: string } }) =>
  it.quantity > 1 ? `${it.service.name} ×${it.quantity}` : it.service.name;
const delayLabel = (diffDays: number) =>
  diffDays > 0
    ? `scade tra ${diffDays} gg`
    : diffDays === 0
      ? "scade oggi"
      : `in ritardo di ${-diffDays} gg`;
const hr = (title: string) =>
  console.log(`\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}`);

const adminEmail = process.env.ADMIN_EMAIL ?? "(ADMIN_EMAIL non configurata)";
const appUrl = process.env.APP_URL;

// ═════════════════════════════════════════════════════════════════════════════
// CRON REMINDER (/api/cron/reminders)
// ═════════════════════════════════════════════════════════════════════════════
async function previewReminders() {
  hr(`CRON REMINDER — /api/cron/reminders — riferimento ${dateTime(now)}`);

  const settings = await loadReminderThresholds();
  const activationHours = [...(await loadAutoChargeReminderHours())].sort(
    (a, b) => a - b,
  );
  console.log(
    `Soglie: lunghe ${JSON.stringify(settings.thresholdsLongDays)} · brevi ${JSON.stringify(settings.thresholdsShortDays)} · ` +
      `post-scadenza ${JSON.stringify(settings.overdueDays)} · cessazione al giorno ${settings.cessationDay}`,
  );
  console.log(`Admin: ${adminEmail} · APP_URL: ${appUrl ?? "(non configurato: nessun link/CTA)"}`);

  // ── Step 1 della route: ricalcolo status (scritture DB, nessuna email) ────
  const toRecalc = await prisma.subscriptionItem.findMany({
    where: { status: { notIn: [...BLOCKING] } },
    select: {
      id: true,
      status: true,
      endDate: true,
      billingPeriod: true,
      customPeriodDays: true,
      lastRenewalAt: true,
    },
  });
  const transitions = new Map<string, number>();
  for (const it of toRecalc) {
    const next = computeItemStatus(it);
    if (next !== it.status) {
      const k = `${it.status} → ${next}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
  }
  console.log(
    `\nRicalcolo status (calcolato sull'ora ATTUALE, aggiorna solo il campo status):`,
  );
  if (transitions.size === 0) console.log("  nessuna modifica");
  for (const [k, n] of transitions) console.log(`  ${k}: ${n} righe`);

  // ── Step 2: reminder / preavvisi / cessazioni ────────────────────────────
  const dedupeKey = reminderDayKey(now);
  const items = await loadReminderItems();
  items.sort((a, b) =>
    clientDisplayName(a.subscription.client).localeCompare(
      clientDisplayName(b.subscription.client),
    ),
  );

  let emailsToSend = 0;
  let emailsSkipped = 0;
  let emailsNoAddress = 0;
  let newCheckoutSessions = 0;
  let newAutoChargeRequests = 0;
  let cessations = 0;
  const overdueUntouched: { item: ReminderItem; diffDays: number }[] = [];
  let rows = 0;

  for (const item of items) {
    const client = item.subscription.client;
    const action = selectReminderAction(item, now, settings);
    if (!action) {
      const diff = Math.ceil((item.endDate.getTime() - now.getTime()) / MS_PER_DAY);
      if (-diff > settings.cessationDay) overdueUntouched.push({ item, diffDays: diff });
      continue;
    }
    rows++;

    const netCents = item.priceCents * item.quantity;
    const { vatCents, grossCents } = addVatToNet(netCents);
    const feeCents = computeServiceFeeCents(
      grossCents,
      item.subscription.serviceFeeEnabled,
    );
    const pm = item.autoChargeEnabled
      ? `rinnovo automatico (carta ${client.stripeDefaultPaymentMethodId ?? "NON salvata"})`
      : "manuale: bonifico o link Stripe";

    const label =
      action.kind === "PREAVVISO_ADDEBITO"
        ? "PREAVVISO_ADDEBITO"
        : `${action.milestone.type}${action.milestone.isCessationTrigger ? " + CESSAZIONE" : ""}`;
    console.log(
      `\n▸ ${clientDisplayName(client)} <${client.email || "senza email"}> · abb. ${item.subscriptionId}`,
    );
    console.log(
      `  ${label} · ${serviceLabel(item)} · scadenza ${date(item.endDate)} (${delayLabel(action.diffDays)}) · stato ${item.status}`,
    );
    console.log(
      `  Importo: netto ${money(netCents, item.currency)} · IVA ${money(vatCents, item.currency)} · lordo ${money(grossCents, item.currency)}` +
        (feeCents > 0
          ? ` · con costo servizio ${money(grossCents + feeCents, item.currency)}`
          : ""),
    );
    console.log(`  Pagamento: ${pm}`);

    if (action.kind === "PREAVVISO_ADDEBITO") {
      if (await hasNotificationLog(item.id, "PREAVVISO_ADDEBITO", dedupeKey)) {
        console.log(`  Cliente: SALTATO (già inviato oggi)`);
        emailsSkipped++;
      } else if (!client.email) {
        console.log(`  Cliente: NON INVIABILE (cliente senza email → log FALLITA)`);
        emailsNoAddress++;
      } else {
        console.log(`  Cliente: INVIA preavviso addebito a ${client.email}`);
        emailsToSend++;
      }
      continue;
    }

    const { milestone } = action;
    if (await hasNotificationLog(item.id, milestone.type, `${dedupeKey}-admin`)) {
      console.log(`  Admin:   SALTATO (già inviato oggi)`);
      emailsSkipped++;
    } else {
      console.log(`  Admin:   INVIA a ${adminEmail}`);
      emailsToSend++;
    }

    if (await hasNotificationLog(item.id, milestone.type, `${dedupeKey}-client`)) {
      console.log(`  Cliente: SALTATO (già inviato oggi)`);
      emailsSkipped++;
    } else if (!client.email) {
      console.log(`  Cliente: NON INVIABILE (cliente senza email → log FALLITA)`);
      emailsNoAddress++;
    } else {
      console.log(`  Cliente: INVIA a ${client.email}`);
      emailsToSend++;
      if (!item.autoChargeEnabled && appUrl) {
        const reusable = await findReusablePaymentToken(item.id, now);
        if (reusable) {
          console.log(`  Link pagamento: riusa Payment IN_ATTESA esistente`);
        } else {
          console.log(
            `  Link pagamento: CREEREBBE Checkout Session Stripe + Payment IN_ATTESA (${money(grossCents + feeCents, item.currency)})`,
          );
          newCheckoutSessions++;
        }
        if (milestone.type !== "CESSAZIONE_MOROSITA") {
          const pending = await findPendingAutoChargeRequestToken(client.id, item.id);
          if (pending) {
            console.log(`  CTA rinnovo automatico: riusa AutoChargeRequest pendente`);
          } else {
            console.log(
              `  CTA rinnovo automatico: CREEREBBE AutoChargeRequest → il cron orario invierà ` +
                `sollecito al cliente a ${activationHours.slice(0, -1).join("/") || "-"}h ed escalation admin a ${activationHours.at(-1) ?? "-"}h`,
            );
            newAutoChargeRequests++;
          }
        }
      }
      if (item.autoChargeEnabled && action.diffDays === 0) {
        console.log(
          `  ⚠ Rinnovo automatico attivo: il sollecito parte alle 8:00, PRIMA dell'addebito delle 9:00`,
        );
      }
    }
    if (milestone.isCessationTrigger) {
      console.log(`  ⚠ La riga passerebbe a CESSATO`);
      cessations++;
    }
  }

  if (rows === 0) console.log("\nNessuna riga su una milestone di reminder.");

  console.log(`\nRiepilogo reminder:`);
  console.log(`  righe coinvolte:                 ${rows}`);
  console.log(`  email da inviare:                ${emailsToSend}`);
  console.log(`  email saltate (già inviate oggi): ${emailsSkipped}`);
  console.log(`  clienti senza email:             ${emailsNoAddress}`);
  console.log(`  nuove Checkout Session Stripe:   ${newCheckoutSessions}`);
  console.log(`  nuove AutoChargeRequest:         ${newAutoChargeRequests}`);
  console.log(`  cessazioni per morosità:         ${cessations}`);

  if (overdueUntouched.length > 0) {
    console.log(
      `\nArretrati oltre il giorno di cessazione (${settings.cessationDay}) che il cron NON toccherà (nessuna email, nessuna cessazione):`,
    );
    for (const { item, diffDays } of overdueUntouched) {
      console.log(
        `  - ${clientDisplayName(item.subscription.client)} · ${serviceLabel(item)} · scadenza ${date(item.endDate)} ` +
          `(${delayLabel(diffDays)}) · stato ${item.status}${item.autoChargeEnabled ? " · RINNOVO AUTOMATICO ATTIVO" : ""}`,
      );
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CRON AUTO-CHARGE (/api/cron/auto-charge)
// ═════════════════════════════════════════════════════════════════════════════
async function previewAutoCharge() {
  hr(`CRON AUTO-CHARGE — /api/cron/auto-charge — riferimento ${dateTime(now)}`);

  const stripe =
    checkStripe && process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY)
      : null;
  if (checkStripe && !stripe) console.log("--stripe ignorato: STRIPE_SECRET_KEY mancante");

  const candidates = await loadAutoChargeCandidates();
  const eligible: EligibleItem[] = [];
  const disabled: EligibleItem[] = [];
  const attemptedToday: EligibleItem[] = [];
  for (const item of candidates) {
    const decision = classifyAutoChargeCandidate(item, now);
    if (decision === "ELIGIBLE") eligible.push(item);
    else if (decision === "DISABLE_EXPIRED") disabled.push(item);
    else if (decision === "ALREADY_ATTEMPTED_TODAY") attemptedToday.push(item);
  }

  // Informativo: righe con rinnovo automatico ma senza carta (escluse dalla query).
  const noCard = await prisma.subscriptionItem.findMany({
    where: {
      autoChargeEnabled: true,
      status: { notIn: [...BLOCKING] },
      endDate: { lte: now },
      subscription: { client: { stripeDefaultPaymentMethodId: null } },
    },
    include: { service: true, subscription: { include: { client: true } } },
  });

  const groups = groupAutoChargeItems(eligible);
  let totalCharged = 0;
  let multiCatchUp = 0;

  for (const group of groups.values()) {
    const first = group[0];
    const client = first.subscription.client;
    const currency = first.currency;
    const itemGrossCents = group.map(
      (it) => addVatToNet(it.priceCents * it.quantity).grossCents,
    );
    const servicesCents = itemGrossCents.reduce((s, c) => s + c, 0);
    const serviceFeeCents = computeServiceFeeCents(
      servicesCents,
      first.subscription.serviceFeeEnabled,
    );
    const totalCents = servicesCents + serviceFeeCents;
    totalCharged += totalCents;

    console.log(
      `\n▸ ${clientDisplayName(client)} <${client.email || "senza email"}> · abb. ${first.subscriptionId}`,
    );
    for (const [idx, it] of group.entries()) {
      const netCents = it.priceCents * it.quantity;
      const lateDays = Math.floor((now.getTime() - it.endDate.getTime()) / MS_PER_DAY);
      const duration = periodDurationDays(it);
      // Il rinnovo avanza di UN periodo dal vecchio endDate: se servono più
      // periodi per superare oggi, il cron riaddebiterà nei giorni successivi.
      const renewalsNeeded =
        duration != null
          ? Math.floor((now.getTime() - it.endDate.getTime()) / (duration * MS_PER_DAY)) + 1
          : null;
      console.log(
        `  - ${serviceLabel(it)} · scadenza ${date(it.endDate)} (in ritardo di ${lateDays} gg) · ` +
          `netto ${money(netCents, currency)} · lordo ${money(itemGrossCents[idx], currency)} · tentativi falliti ${it.autoChargeFailCount}`,
      );
      if (renewalsNeeded != null && renewalsNeeded > 1) {
        console.log(
          `    ⚠ servono ${renewalsNeeded} rinnovi per tornare in pari: ${renewalsNeeded} addebiti in ${renewalsNeeded} giorni consecutivi`,
        );
        multiCatchUp++;
      }
      if (duration == null) {
        console.log(`    ⚠ PERSONALIZZATA senza durata: addebito senza avanzamento scadenza → riaddebito ogni giorno`);
        multiCatchUp++;
      }
      if (it.autoChargeFailCount + 1 >= 2) {
        console.log(
          `    ⚠ se fallisce: rinnovo automatico DISATTIVATO + link di pagamento al cliente + email all'admin`,
        );
      }
      const pending = await prisma.paymentItem.findMany({
        where: { subscriptionItemId: it.id, status: "IN_ATTESA" },
        include: { payment: true },
      });
      for (const p of pending) {
        console.log(
          `    ⚠ esiste già un Payment IN_ATTESA (${p.payment.method}, creato ${dateTime(p.payment.createdAt)}` +
            `${p.payment.checkoutExpiresAt ? `, link scade ${dateTime(p.payment.checkoutExpiresAt)}` : ""}): rischio doppio pagamento`,
        );
      }
    }
    console.log(
      `  Addebito: servizi lordo ${money(servicesCents, currency)} + costo servizio ${money(serviceFeeCents, currency)} = TOTALE ${money(totalCents, currency)}`,
    );
    let pmInfo = client.stripeDefaultPaymentMethodId ?? "-";
    if (stripe && client.stripeDefaultPaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(client.stripeDefaultPaymentMethodId);
        if (pm.card) {
          const exp = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59);
          pmInfo += ` (${pm.card.brand} •••• ${pm.card.last4}, scade ${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}${exp < now ? " — SCADUTA" : ""})`;
        } else {
          pmInfo += ` (${pm.type})`;
        }
        if (pm.customer && pm.customer !== client.stripeCustomerId) {
          pmInfo += ` ⚠ collegato a un customer diverso (${String(pm.customer)})`;
        }
      } catch (e) {
        pmInfo += ` ⚠ verifica Stripe fallita: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    console.log(`  Metodo: carta salvata ${pmInfo} · customer ${client.stripeCustomerId}`);
    console.log(
      `  Email se riesce: conferma + ricevuta a ${adminEmail}${client.email ? ` e ${client.email}` : ""}`,
    );
  }

  if (groups.size === 0) console.log("\nNessun addebito da eseguire.");

  if (disabled.length > 0) {
    console.log(`\nRighe con fine rinnovo automatico superata → verrebbero DISATTIVATE (nessun addebito):`);
    for (const it of disabled) {
      console.log(
        `  - ${clientDisplayName(it.subscription.client)} · ${serviceLabel(it)} · fine auto-charge ${date(it.autoChargeEndDate!)}`,
      );
    }
  }
  if (attemptedToday.length > 0) {
    console.log(`\nRighe già tentate oggi (saltate): ${attemptedToday.length}`);
  }
  if (noCard.length > 0) {
    console.log(`\nRighe scadute con rinnovo automatico attivo ma SENZA carta salvata (ignorate dal cron):`);
    for (const it of noCard) {
      console.log(
        `  - ${clientDisplayName(it.subscription.client)} · ${serviceLabel(it)} · scadenza ${date(it.endDate)}`,
      );
    }
  }

  console.log(`\nRiepilogo auto-charge:`);
  console.log(`  addebiti Stripe (gruppi):        ${groups.size}`);
  console.log(`  righe addebitate:                ${eligible.length}`);
  console.log(`  importo totale:                  ${money(totalCharged)}`);
  console.log(`  righe con recupero multi-giorno: ${multiCatchUp}`);
  console.log(`  righe da disattivare:            ${disabled.length}`);
}

async function main() {
  console.log(
    `cron-preview — SOLA LETTURA — DB ${process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//***@") ?? "(DATABASE_URL mancante)"}`,
  );
  await previewReminders();
  await previewAutoCharge();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
