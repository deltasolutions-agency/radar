import "server-only";
import crypto from "node:crypto";

/**
 * Avvisi da Radar alla console Delta Cloud (verso opposto di console-integration).
 * Stesso segreto e stesso schema di firma, header X-Radar-Signature:
 *   t=<unix>,v1=hex(hmac(CONSOLE_INTEGRATION_SECRET, `${t}.POST.${path}.${body}`))
 * Serve CONSOLE_URL (es. https://console.deltasolutions.agency).
 */
const PATH = "/api/integrations/radar/events";

export function consoleNotifyConfigured(): boolean {
  return !!process.env.CONSOLE_URL && (process.env.CONSOLE_INTEGRATION_SECRET ?? "").length >= 32;
}

export type ConsoleEvent = {
  type: "payment.confirmed";
  paymentId: string;
  subscriptionId: string;
  kind: "ACTIVATION" | "RENEWAL";
};

/** true se la console ha ricevuto l'avviso. Tre tentativi; non lancia mai. */
export async function notifyConsole(event: ConsoleEvent): Promise<boolean> {
  if (!consoleNotifyConfigured()) return false;
  const base = process.env.CONSOLE_URL!.replace(/\/$/, "");
  const raw = JSON.stringify(event);
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto
      .createHmac("sha256", process.env.CONSOLE_INTEGRATION_SECRET!)
      .update(`${t}.POST.${PATH}.${raw}`)
      .digest("hex");
    try {
      const res = await fetch(base + PATH, {
        method: "POST",
        body: raw,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Radar-Signature": `t=${t},v1=${sig}` },
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) {
        console.error(`[console-notify] la console ha rifiutato l'avviso (${res.status})`);
        return false;
      }
    } catch (e) {
      console.error("[console-notify] console non raggiungibile:", e);
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return false;
}
