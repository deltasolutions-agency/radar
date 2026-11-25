import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { PLUGIN_SLUG } from "@/lib/vigilantes/protocol";

// Pacchetto del plugin WordPress, generato al volo dalla cartella del repo
// `wordpress-plugin/radar-vigilantes` (niente zip binari nel repo, niente
// dipendenze sul server). Usato dal download in dashboard e dall'auto-update.

const PLUGIN_DIR = path.join(process.cwd(), "wordpress-plugin", PLUGIN_SLUG);
const MAIN_FILE = `${PLUGIN_SLUG}.php`;

export type PluginInfo = {
  version: string;
  requiresWp: string | null;
  requiresPhp: string | null;
  testedUpTo: string | null;
};

function header(src: string, name: string): string | null {
  const m = new RegExp(`^[\\s*#@/]*${name}:\\s*(.+)$`, "mi").exec(src);
  return m ? m[1].trim() : null;
}

export async function readPluginInfo(): Promise<PluginInfo> {
  const src = await fs.readFile(path.join(PLUGIN_DIR, MAIN_FILE), "utf8");
  const version = header(src, "Version");
  if (!version) throw new Error("Versione del plugin non trovata nell'intestazione");
  const readme = await fs.readFile(path.join(PLUGIN_DIR, "readme.txt"), "utf8").catch(() => "");
  return {
    version,
    requiresWp: header(src, "Requires at least"),
    requiresPhp: header(src, "Requires PHP"),
    testedUpTo: header(readme, "Tested up to"),
  };
}

async function listFiles(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

// ── ZIP minimale (deflate) ─────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZip(entries: { name: string; data: Buffer }[], mtime = new Date()): Buffer {
  const { time, date } = dosDateTime(mtime);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const compressed = deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versione necessaria
    local.writeUInt16LE(0x0800, 6); // nomi UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // creato da: Unix, v3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // permessi rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

let cache: { version: string; zip: Buffer } | null = null;

/** Zip installabile (cartella radar-vigilantes/), in cache per versione. */
export async function buildPluginZip(): Promise<{ version: string; zip: Buffer; filename: string }> {
  const { version } = await readPluginInfo();
  if (!cache || cache.version !== version || process.env.NODE_ENV !== "production") {
    const files = await listFiles(PLUGIN_DIR);
    const entries = await Promise.all(
      files.map(async (f) => ({
        name: `${PLUGIN_SLUG}/${f}`,
        data: await fs.readFile(path.join(PLUGIN_DIR, f)),
      })),
    );
    cache = { version, zip: buildZip(entries) };
  }
  return { version, zip: cache.zip, filename: `${PLUGIN_SLUG}-${version}.zip` };
}
