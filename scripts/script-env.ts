// Preparazione ambiente per gli script eseguiti con `npx tsx` fuori da Next.js.
// Va importato PER PRIMO: tsx compila gli import in require() nell'ordine.
//
// 1. Carica .env dalla root del progetto (senza sovrascrivere variabili già
//    presenti nell'ambiente).
// 2. Neutralizza `import "server-only"`: è un alias interno di Next.js e il
//    pacchetto non esiste in node_modules.
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    let value = rest;
    const quoted = value.match(/^(['"])(.*)\1/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "").trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: LoadFn };
const originalLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};
