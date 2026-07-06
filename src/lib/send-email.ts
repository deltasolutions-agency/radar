import "server-only";
import type { NotificationStatus } from "@prisma/client";
import { getResend } from "@/lib/resend";

export type SendResult = {
  status: NotificationStatus;
  resendId?: string;
  error?: string;
};

/**
 * Invia un'email transazionale via Resend (from EMAIL_FROM → to ADMIN_EMAIL).
 * NON lancia mai: qualsiasi errore (config mancante, Resend down, ...) viene
 * restituito come { status: "FALLITA", error }. Il chiamante decide come
 * registrarlo (NotificationLog) senza rischiare di far fallire il flusso.
 */
/** Allegato email (es. lettera di benvenuto PDF). */
export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export async function sendEmail(
  content: {
    subject: string;
    text: string;
    html: string;
  },
  to?: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const recipient = to ?? process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!recipient || !from) {
    return {
      status: "FALLITA",
      error: "Destinatario o EMAIL_FROM non configurato",
    };
  }
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to: recipient,
      subject: content.subject,
      text: content.text,
      html: content.html,
      ...(attachments && attachments.length > 0
        ? { attachments }
        : {}),
    });
    if (error) {
      return { status: "FALLITA", error: error.message ?? String(error) };
    }
    return { status: "INVIATA", resendId: data?.id };
  } catch (e) {
    return {
      status: "FALLITA",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
