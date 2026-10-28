// Anteprima della lettera di benvenuto PDF in italiano e in inglese.
//
//   npx tsx scripts/preview-welcome-pdf.ts ["Nome cliente"]
//
// Scrive tmp/pdf-preview/welcome-it.pdf e tmp/pdf-preview/welcome-en.pdf.
// Non invia email e non legge/scrive il DB.
import "./script-env";
import fs from "node:fs/promises";
import path from "node:path";
import { buildWelcomeLetterPdf } from "@/lib/welcome-letter-pdf";
import type { Lang } from "@/lib/i18n";

async function main() {
  const clientName = process.argv[2] ?? "Mario Rossi S.r.l.";
  const outDir = path.resolve(__dirname, "..", "tmp", "pdf-preview");
  await fs.mkdir(outDir, { recursive: true });
  for (const lang of ["it", "en"] as Lang[]) {
    const pdf = await buildWelcomeLetterPdf(clientName, lang);
    const file = path.join(outDir, `welcome-${lang}.pdf`);
    await fs.writeFile(file, pdf);
    console.log(`${lang}: ${file} (${pdf.length} byte)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
