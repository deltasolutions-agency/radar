import "server-only";
import Stripe from "stripe";

/**
 * Client Stripe condiviso. Non forziamo `apiVersion`: usiamo il default del
 * pacchetto installato per evitare mismatch di tipi tra versioni.
 *
 * La chiave è letta a runtime: se manca, l'istanziazione fallisce solo quando
 * il modulo pagamenti viene effettivamente usato (non a build-time).
 */
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY non configurata");
  }
  return new Stripe(key);
}

export { getStripe };
