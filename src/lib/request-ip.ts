import "server-only";
import { headers } from "next/headers";

/**
 * IP reale del richiedente. Dietro Cloudflare + Nginx l'IP client è in
 * `cf-connecting-ip` (iniettato da Cloudflare); fallback al primo valore di
 * `x-forwarded-for`, poi "unknown". NB: dipende dalla configurazione proxy.
 */
export function clientIp(): string {
  const h = headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}
