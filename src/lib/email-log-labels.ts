import type {
  EmailLogStatus,
  EmailLogType,
  EmailTrigger,
} from "@prisma/client";

export const EMAIL_LOG_TYPE_LABELS: Record<EmailLogType, string> = {
  REMINDER: "Reminder scadenza",
  AUTOCHARGE_NOTICE: "Preavviso addebito",
  AUTOCHARGE_FAILED: "Addebito fallito",
  AUTOCHARGE_REQUEST: "Richiesta rinnovo automatico",
  AUTOCHARGE_ACTIVATION_REMINDER: "Sollecito attivazione",
  ADMIN_ESCALATION: "Escalation admin",
  ADMIN_SUMMARY: "Riepilogo cron",
  WELCOME: "Benvenuto",
  PAYMENT_RECEIPT: "Conferma pagamento",
  PAYMENT_LINK: "Link di pagamento",
  REFUND: "Storno",
  DATA_CHANGE_NOTICE: "Dati modificati dal cliente",
  DATA_UPDATE_REQUEST: "Richiesta verifica dati",
  FIRST_PAYMENT_LINK: "Link primo pagamento",
  FIRST_PAYMENT_REMINDER: "Sollecito primo pagamento",
  FIRST_PAYMENT_ADMIN_ALERT: "Primo pagamento non ricevuto (admin)",
  LEDGER_OVERDUE_ALERT: "Alert Amministrazione",
  OTHER: "Altro",
};

export const EMAIL_LOG_STATUS_LABELS: Record<EmailLogStatus, string> = {
  SENT: "Inviata",
  FAILED: "Fallita",
  SKIPPED: "Saltata",
};

export const EMAIL_TRIGGER_LABELS: Record<EmailTrigger, string> = {
  CRON: "Cron",
  MANUAL: "Manuale",
  WEBHOOK: "Webhook",
  SYSTEM: "Sistema",
  CLIENT: "Cliente",
};

/** Data e ora in Europe/Rome (es. "21/10/2026, 08:00:03"). */
export function formatRomeDateTime(d: Date): string {
  return d.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
