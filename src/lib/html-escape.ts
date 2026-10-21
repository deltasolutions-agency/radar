/**
 * Escape dei caratteri speciali HTML per interpolare valori dinamici (nomi,
 * ragione sociale, servizi, campi compilati dal cliente, messaggi di errore)
 * nei template HTML delle email. Sicuro anche dentro attributi tra virgolette.
 */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
