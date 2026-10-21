// Anteprima di SOLA LETTURA dei cron /api/cron/reminders, /api/cron/auto-charge
// e /api/cron/autocharge-reminders.
//
//   npx tsx scripts/cron-preview.ts                       # riferimento: adesso
//   npx tsx scripts/cron-preview.ts --at=2026-10-22T08:00  # simula l'orario del cron
//   npx tsx scripts/cron-preview.ts --stripe              # + verifica carta (solo GET)
//
// Usa gli STESSI piani delle route (src/lib/cron/*-plan.ts,
// activation-reminders.ts): è la stessa logica di ?dryRun=1. Non invia email,
// non scrive sul DB e non crea/modifica nulla su Stripe: con --stripe esegue
// solo paymentMethods.retrieve.
import "./script-env";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { withEndClient } from "@/lib/end-client";
import { clientDisplayName, serviceLabel } from "@/lib/cron/common";
import {
  REMINDER_RECOVERY_DAYS,
  groupServicesLabel,
  milestoneLabel,
  planReminders,
} from "@/lib/cron/reminders-plan";
import {
  AUTOCHARGE_MAX_DELAY_DAYS,
  EXCLUSION_LABELS,
  planAutoCharge,
} from "@/lib/cron/auto-charge-plan";
import { planActivationReminders } from "@/lib/cron/activation-reminders";

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
const date = (d: Date) => d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });
const dateTime = (d: Date) => d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
const delayLabel = (diffDays: number) =>
  diffDays > 0
    ? `scade tra ${diffDays} gg`
    : diffDays === 0
      ? "scade oggi"
      : `in ritardo di ${-diffDays} gg`;
const hr = (title: string) => console.log(`\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}`);

const adminEmail = process.env.ADMIN_EMAIL ?? "(ADMIN_EMAIL non configurata)";
const appUrl = process.env.APP_URL;

// ═════════════════════════════════════════════════════════════════════════════
// CRON REMINDER
// ═════════════════════════════════════════════════════════════════════════════
async function previewReminders() {
  hr(`CRON REMINDER — /api/cron/reminders — riferimento ${dateTime(now)}`);
  const plan = await planReminders(now);
  const s = plan.settings;
  console.log(
    `Soglie: lunghe ${JSON.stringify(s.thresholdsLongDays)} · brevi ${JSON.stringify(s.thresholdsShortDays)} · ` +
      `post-scadenza ${JSON.stringify(s.overdueDays)} · cessazione da ${s.cessationDay} gg · recupero max ${REMINDER_RECOVERY_DAYS} gg`,
  );
  console.log(`Admin: ${adminEmail} · APP_URL: ${appUrl ?? "(non configurato: nessun link/CTA)"}`);

  const transitions = new Map<string, number>();
  for (const c of plan.statusChanges) {
    const k = `${c.from} → ${c.to}`;
    transitions.set(k, (transitions.get(k) ?? 0) + 1);
  }
  console.log(`\nRicalcolo status (aggiorna solo il campo status):`);
  if (transitions.size === 0) console.log("  nessuna modifica");
  for (const [k, n] of transitions) console.log(`  ${k}: ${n} righe`);

  let newLinks = 0;
  let newRequests = 0;
  let cessations = 0;
  for (const g of plan.groups) {
    console.log(`\n▸ ${g.clientName} <${g.clientEmail ?? "senza email"}> · abb. ${g.subscriptionId}`);
    console.log(
      `  ${milestoneLabel(g)}${g.daysLate > 0 ? ` · RECUPERO (dovuta da ${g.daysLate} gg)` : ""} · scadenza ${date(g.endDate)} (${delayLabel(g.diffDays)})`,
    );
    for (const it of g.items) {
      const net = it.priceCents * it.quantity;
      console.log(`  - ${withEndClient(serviceLabel(it), it.endClientName)} · netto ${money(net, it.currency)} · stato ${it.status}`);
    }
    const a = g.amounts;
    console.log(
      `  Importo: netto ${money(a.netCents, g.currency)} · IVA ${money(a.vatCents, g.currency)} · lordo ${money(a.grossCents, g.currency)}` +
        (a.serviceFeeCents > 0 ? ` · con costo servizio (Stripe) ${money(a.totalCents, g.currency)}` : ""),
    );
    console.log(
      `  Pagamento: ${g.autoCharge ? `rinnovo automatico (carta ${g.items[0].subscription.client.stripeDefaultPaymentMethodId ?? "NON salvata"})` : "manuale: bonifico o link Stripe"}`,
    );
    console.log(
      `  Email: ${g.kind === "PREAVVISO" ? "preavviso addebito" : "reminder"} → ${g.clientEmail ?? "NON INVIABILE (cliente senza email → log FALLITA)"}`,
    );
    if (g.kind === "REMINDER" && !g.autoCharge && appUrl && g.clientEmail) {
      if (g.reusablePayToken) console.log(`  Link pagamento: riusa Payment in attesa esistente`);
      else {
        console.log(`  Link pagamento: CREEREBBE Checkout Session Stripe + Payment IN_ATTESA (${money(a.totalCents, g.currency)})`);
        newLinks++;
      }
      if (!g.isCessation) {
        if (g.reusableAutoChargeToken) console.log(`  CTA rinnovo automatico: riusa richiesta pendente`);
        else {
          console.log(`  CTA rinnovo automatico: CREEREBBE AutoChargeRequest (→ solleciti del cron orario)`);
          newRequests++;
        }
      }
    }
    if (g.autoCharge && g.kind === "REMINDER" && g.diffDays === 0) {
      console.log(`  (rinnovo automatico attivo ma carta non utilizzabile o addebito escluso: il sollecito parte)`);
    }
    if (g.isCessation) {
      console.log(`  ⚠ Le righe passerebbero a CESSATO`);
      cessations += g.items.length;
    }
  }
  if (plan.groups.length === 0) console.log("\nNessuna email da inviare.");
  if (plan.autoChargeToday.length > 0) {
    console.log(`\nSollecito "scade oggi" NON inviato (addebito automatico alle 9:00 con carta utilizzabile):`);
    for (const it of plan.autoChargeToday) {
      console.log(`  - ${clientDisplayName(it.subscription.client)} · ${withEndClient(serviceLabel(it), it.endClientName)} · scadenza ${date(it.endDate)}`);
    }
  }

  console.log(`\nRiepilogo reminder:`);
  console.log(`  righe candidate:                    ${plan.candidates}`);
  console.log(`  email al cliente:                   ${plan.groups.length}`);
  console.log(`    di cui senza email:               ${plan.groups.filter((g) => !g.clientEmail).length}`);
  console.log(`  righe con milestone già inviata:    ${plan.alreadySent}`);
  console.log(`  nuove Checkout Session Stripe:      ${newLinks}`);
  console.log(`  nuove AutoChargeRequest:            ${newRequests}`);
  console.log(`  righe cessate per morosità:         ${cessations}`);
  console.log(`  riepilogo admin:                    ${plan.groups.length > 0 ? `sì → ${adminEmail}` : "no (nessun invio)"}`);

  if (plan.backlog.length > 0) {
    console.log(`\nArretrati (milestone non inviata da più di ${REMINDER_RECOVERY_DAYS} gg — nessuna email, nessuna cessazione; elencati nel riepilogo admin):`);
    for (const b of plan.backlog) {
      console.log(
        `  - ${clientDisplayName(b.item.subscription.client)} · ${withEndClient(serviceLabel(b.item), b.item.endClientName)} · ` +
          `${milestoneLabel(b)} da ${b.daysLate} gg · scadenza ${date(b.item.endDate)} · stato ${b.item.status}` +
          (b.item.autoChargeEnabled ? " · RINNOVO AUTOMATICO ATTIVO" : ""),
      );
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CRON AUTO-CHARGE
// ═════════════════════════════════════════════════════════════════════════════
async function previewAutoCharge() {
  hr(`CRON AUTO-CHARGE — /api/cron/auto-charge — riferimento ${dateTime(now)}`);
  const plan = await planAutoCharge(now);
  const stripe =
    checkStripe && process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  if (checkStripe && !stripe) console.log("--stripe ignorato: STRIPE_SECRET_KEY mancante");

  let total = 0;
  for (const c of plan.charges) {
    total += c.totalCents;
    console.log(`\n▸ ${clientDisplayName(c.client)} <${c.client.email || "senza email"}> · abb. ${c.subscriptionId}`);
    c.items.forEach((it, idx) => {
      const late = Math.floor((now.getTime() - it.endDate.getTime()) / 86_400_000);
      console.log(
        `  - ${withEndClient(serviceLabel(it), it.endClientName)} · scadenza ${date(it.endDate)} (in ritardo di ${late} gg) · ` +
          `netto ${money(it.priceCents * it.quantity, c.currency)} · lordo ${money(c.itemGrossCents[idx], c.currency)} · tentativi falliti ${it.autoChargeFailCount}`,
      );
      if (it.autoChargeFailCount + 1 >= 2) {
        console.log(`    ⚠ se fallisce: rinnovo automatico DISATTIVATO + link di pagamento al cliente + email all'admin`);
      }
    });
    console.log(
      `  Addebito: servizi lordo ${money(c.servicesCents, c.currency)} + costo servizio ${money(c.serviceFeeCents, c.currency)} = TOTALE ${money(c.totalCents, c.currency)}`,
    );
    let pmInfo = c.client.stripeDefaultPaymentMethodId ?? "-";
    if (stripe && c.client.stripeDefaultPaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(c.client.stripeDefaultPaymentMethodId);
        if (pm.card) {
          const exp = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59);
          pmInfo += ` (${pm.card.brand} •••• ${pm.card.last4}, scade ${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}${exp < now ? " — SCADUTA" : ""})`;
        } else pmInfo += ` (${pm.type})`;
        if (pm.customer && pm.customer !== c.client.stripeCustomerId) {
          pmInfo += ` ⚠ collegato a un customer diverso (${String(pm.customer)})`;
        }
      } catch (e) {
        pmInfo += ` ⚠ verifica Stripe fallita: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    console.log(`  Metodo: carta salvata ${pmInfo} · customer ${c.client.stripeCustomerId}`);
    console.log(`  Descrizione Stripe: ${c.description}`);
    console.log(`  Idempotency key: ${c.idempotencyKey}`);
    console.log(`  Email se riesce: conferma + ricevuta a ${adminEmail}${c.client.email ? ` e ${c.client.email}` : ""}`);
  }
  if (plan.charges.length === 0) console.log("\nNessun addebito da eseguire.");

  if (plan.excluded.length > 0) {
    console.log(`\nEscluse dall'addebito (segnalate nel riepilogo admin):`);
    for (const e of plan.excluded) {
      console.log(
        `  - ${clientDisplayName(e.item.subscription.client)} · ${withEndClient(serviceLabel(e.item), e.item.endClientName)} · ` +
          `scadenza ${date(e.item.endDate)} (ritardo ${e.lateDays} gg) — ${EXCLUSION_LABELS[e.reason]}`,
      );
    }
  }
  if (plan.toDisable.length > 0) {
    console.log(`\nRinnovo automatico da DISATTIVARE (data di fine superata, nessun addebito):`);
    for (const it of plan.toDisable) {
      console.log(`  - ${clientDisplayName(it.subscription.client)} · ${serviceLabel(it)} · fine ${date(it.autoChargeEndDate!)}`);
    }
  }
  if (plan.attemptedToday.length > 0) console.log(`\nRighe già tentate oggi (saltate): ${plan.attemptedToday.length}`);

  console.log(`\nRiepilogo auto-charge (ritardo massimo ${AUTOCHARGE_MAX_DELAY_DAYS} gg):`);
  console.log(`  addebiti Stripe (gruppi):  ${plan.charges.length}`);
  console.log(`  righe addebitate:          ${plan.charges.reduce((n, c) => n + c.items.length, 0)}`);
  console.log(`  importo totale:            ${money(total)}`);
  console.log(`  righe escluse:             ${plan.excluded.length}`);
  console.log(`  righe da disattivare:      ${plan.toDisable.length}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// CRON ORARIO — solleciti di attivazione
// ═════════════════════════════════════════════════════════════════════════════
async function previewActivation() {
  hr(`CRON ORARIO — /api/cron/autocharge-reminders — riferimento ${dateTime(now)}`);
  const plan = await planActivationReminders(now);
  console.log(`Soglie: ${JSON.stringify(plan.hours)} h (l'ultima è l'escalation admin) · richieste nelle ultime 48h: ${plan.candidates}`);
  for (const g of plan.groups) {
    const to = g.kind === "ADMIN_ESCALATION" ? adminEmail : (g.clientEmail ?? "NON INVIABILE (senza email)");
    console.log(`\n▸ ${g.kind === "ADMIN_ESCALATION" ? "Escalation admin" : "Sollecito cliente"} · ${g.clientName} → ${to}`);
    for (const m of g.marks) {
      const services = m.request.itemIds
        .map((id) => plan.itemsById.get(id))
        .filter(Boolean)
        .map((x) => withEndClient(x!.serviceName, x!.endClientName))
        .join(", ");
      console.log(
        `  - richiesta del ${dateTime(m.request.createdAt)} · soglia ${m.mark}h${m.attempts > 0 ? ` · ritentativo n. ${m.attempts + 1}` : ""} · ${services || "(servizi non trovati)"}`,
      );
    }
  }
  if (plan.groups.length === 0) console.log("\nNessun sollecito da inviare.");
}

async function main() {
  console.log(
    `cron-preview — SOLA LETTURA — DB ${process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//***@") ?? "(DATABASE_URL mancante)"}`,
  );
  await previewReminders();
  await previewAutoCharge();
  await previewActivation();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
