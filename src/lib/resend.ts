import "server-only";
import { Resend } from "resend";

/**
 * Client Resend condiviso. La chiave è letta a runtime: se manca, l'uso del
 * modulo notifiche fallisce solo quando serve (non a build-time).
 */
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY non configurata");
  }
  return new Resend(key);
}

export { getResend };
