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
export async function sendEmail(content: {
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  const to = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!to || !from) {
    return {
      status: "FALLITA",
      error: "ADMIN_EMAIL o EMAIL_FROM non configurata",
    };
  }
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
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
