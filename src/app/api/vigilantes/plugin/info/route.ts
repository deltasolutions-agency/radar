import { NextResponse } from "next/server";
import { readPluginInfo } from "@/lib/vigilantes/plugin-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vigilantes/plugin/info — versione corrente del plugin, letta
// dall'auto-update dei siti. Pubblica: il codice del plugin non è riservato.
export async function GET() {
  const info = await readPluginInfo();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return NextResponse.json(
    {
      slug: "radar-vigilantes",
      name: "Radar Vigilantes",
      version: info.version,
      requires: info.requiresWp,
      requires_php: info.requiresPhp,
      tested: info.testedUpTo,
      download_url: `${appUrl}/api/vigilantes/plugin/download`,
      homepage: appUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
