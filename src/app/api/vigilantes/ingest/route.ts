import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ingestReport } from "@/lib/vigilantes/ingest";
import { siteOptions } from "@/lib/vigilantes/pull";
import {
  HEADER_SIG,
  HEADER_SITE,
  HEADER_TS,
  INGEST_ROUTE,
  pushSchema,
  verifySignature,
} from "@/lib/vigilantes/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 2 * 1024 * 1024;

function deny(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// POST /api/vigilantes/ingest — push dal plugin (eventi + report completo).
// Nessuna sessione: autenticato dalla firma HMAC con il secret del sito.
export async function POST(req: NextRequest) {
  const siteId = req.headers.get(HEADER_SITE);
  if (!siteId) return deny("Sito non indicato", 401);

  const body = await req.text();
  if (body.length > MAX_BODY) return deny("Report troppo grande", 413);

  const site = await prisma.wpSite.findUnique({ where: { id: siteId } });
  // Stessa risposta per sito inesistente e firma errata.
  if (!site) return deny("Firma non valida", 401);
  const check = verifySignature({
    secret: site.secret,
    ts: req.headers.get(HEADER_TS),
    signature: req.headers.get(HEADER_SIG),
    method: "POST",
    route: INGEST_ROUTE,
    body,
  });
  if (!check.ok) return deny(check.reason === "firma non valida" ? "Firma non valida" : check.reason, 401);
  if (!site.enabled) return NextResponse.json({ ok: true, ignored: "sito in pausa", options: siteOptions(site) });

  let parsed;
  try {
    parsed = pushSchema.safeParse(JSON.parse(body));
  } catch {
    return deny("JSON non valido", 400);
  }
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return deny(`Report non valido: ${i?.path.join(".")} ${i?.message ?? ""}`.trim(), 400);
  }

  try {
    const out = await ingestReport(site, parsed.data.report, "PUSH", "WEBHOOK");
    return NextResponse.json({ ok: true, updates: out.updates, opened: out.opened.length, options: siteOptions(site) });
  } catch (e) {
    console.error("[vigilantes] ingest fallito:", e);
    return deny("Errore interno", 500);
  }
}
