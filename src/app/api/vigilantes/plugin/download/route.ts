import { buildPluginZip } from "@/lib/vigilantes/plugin-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vigilantes/plugin/download — zip installabile del plugin
// (download dalla dashboard e pacchetto per l'auto-update dei siti).
export async function GET() {
  const { zip, filename } = await buildPluginZip();
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
