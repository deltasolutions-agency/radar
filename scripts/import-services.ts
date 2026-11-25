// Import del listino da CSV (crea o aggiorna i servizi per nome).
//
//   npx tsx scripts/import-services.ts listino.csv            → anteprima, non scrive nulla
//   npx tsx scripts/import-services.ts listino.csv --applica  → crea/aggiorna
//
// Colonne (separatore ; oppure , — prima riga di intestazione, decimali con la virgola o il punto):
//   nome; tipo; prezzo; periodicita; giorni; rinnovo_automatico; aumento_pct; costo; descrizione; nome_en; descrizione_en; attivo
//   tipo: CLOUD | DOMINIO | HOSTING | SSL | PRIVACY | EMAIL | ALTRO   periodicita: MENSILE | ANNUALE | PERSONALIZZATA (giorni obbligatori)
//   rinnovo_automatico e attivo: si/no (vuoto = si)   prezzo e costo in euro netti   aumento_pct: % di aumento al rinnovo
import "./script-env";
import fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import type { BillingPeriod, ServiceType } from "@prisma/client";

const TYPES = ["CLOUD", "DOMINIO", "HOSTING", "SSL", "PRIVACY", "EMAIL", "ALTRO"];
const PERIODS = ["MENSILE", "ANNUALE", "PERSONALIZZATA"];

function parse(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some((c) => c)) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some((c) => c)) rows.push(row);
  return rows;
}

const euro = (v: string) => { const n = Number(v.replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); if (!Number.isFinite(n) || n < 0) throw new Error(`importo non valido: "${v}"`); return Math.round(n * 100); };
const yes = (v: string) => !v || /^(si|sì|s|yes|y|true|1|x)$/i.test(v);

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--applica");
  if (!file || !fs.existsSync(file)) { console.error("Uso: npx tsx scripts/import-services.ts listino.csv [--applica]"); process.exit(1); }
  const rows = parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const head = rows.shift()!.map((h) => h.toLowerCase().replace(/[^a-z_]/g, ""));
  const col = (r: string[], k: string) => r[head.indexOf(k)] ?? "";
  if (head.indexOf("nome") < 0 || head.indexOf("prezzo") < 0) throw new Error("Servono almeno le colonne nome e prezzo");
  let created = 0, updated = 0, errors = 0;
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      const name = col(r, "nome"); if (!name) throw new Error("nome mancante");
      const type = (col(r, "tipo") || "ALTRO").toUpperCase(); if (!TYPES.includes(type)) throw new Error(`tipo "${type}" non valido`);
      const billingPeriod = (col(r, "periodicita") || "MENSILE").toUpperCase(); if (!PERIODS.includes(billingPeriod)) throw new Error(`periodicità "${billingPeriod}" non valida`);
      const days = col(r, "giorni") ? Number(col(r, "giorni")) : null;
      if (billingPeriod === "PERSONALIZZATA" && !(days && days > 0)) throw new Error("con PERSONALIZZATA servono i giorni");
      const inc = col(r, "aumento_pct") ? Math.round(Number(col(r, "aumento_pct").replace(",", "."))) : 0;
      if (!Number.isFinite(inc) || inc < 0 || inc > 100) throw new Error("aumento_pct non valido");
      const data = {
        name, type: type as ServiceType, priceCents: euro(col(r, "prezzo")), costCents: col(r, "costo") ? euro(col(r, "costo")) : 0,
        billingPeriod: billingPeriod as BillingPeriod, customPeriodDays: billingPeriod === "PERSONALIZZATA" ? days : null,
        autoRenew: yes(col(r, "rinnovo_automatico")), active: yes(col(r, "attivo")), renewalIncreasePercent: inc,
        description: col(r, "descrizione") || null, nameEn: col(r, "nome_en") || null, descriptionEn: col(r, "descrizione_en") || null,
      };
      const existing = await prisma.service.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      const what = `${existing ? "AGGIORNA" : "CREA    "} ${name} · € ${(data.priceCents / 100).toFixed(2)} ${data.billingPeriod}${data.autoRenew ? "" : " · senza rinnovo"}${inc ? ` · +${inc}% al rinnovo` : ""}`;
      if (apply) {
        if (existing) { await prisma.service.update({ where: { id: existing.id }, data }); updated++; }
        else { await prisma.service.create({ data }); created++; }
      }
      console.log((apply ? "✓ " : "· ") + what);
    } catch (e) { errors++; console.log(`✗ riga ${line}: ${(e as Error).message}`); }
  }
  console.log(apply ? `\nFatto: ${created} creati, ${updated} aggiornati, ${errors} errori.` : `\nAnteprima: niente è stato scritto. ${errors ? `${errors} errori da correggere. ` : ""}Rilancia con --applica per importare.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
