// Metodo di pagamento preferito dal cliente (per abbonamento). CARTA mantiene
// tutto il flusso Stripe; BONIFICO e CONTANTI spengono le funzioni della carta.

export const PREFERRED_METHODS = ["CARTA", "BONIFICO", "CONTANTI"] as const;
export type PreferredMethod = (typeof PREFERRED_METHODS)[number];

export const PREFERRED_METHOD_LABELS: Record<PreferredMethod, string> = {
  CARTA: "Carta",
  BONIFICO: "Bonifico",
  CONTANTI: "Contanti",
};

/** Metodo da preimpostare nel pagamento manuale (valori di MANUAL_PAYMENT_METHODS). */
export function manualMethodFor(m: PreferredMethod): string {
  return m === "CONTANTI" ? "Contanti" : "Bonifico";
}
