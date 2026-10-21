import { prisma } from "@/lib/prisma";

/** Conservazione degli EmailLog, in mesi (oltre: cancellati dal cron giornaliero). */
export const EMAIL_LOG_RETENTION_MONTHS = 24;

/** Data limite: gli EmailLog creati prima di questa data vanno cancellati. */
export function emailLogRetentionCutoff(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - EMAIL_LOG_RETENTION_MONTHS);
  return d;
}

/** Cancella gli EmailLog più vecchi della soglia. Ritorna quanti ne ha rimossi. */
export async function purgeOldEmailLogs(now: Date = new Date()): Promise<number> {
  const res = await prisma.emailLog.deleteMany({
    where: { createdAt: { lt: emailLogRetentionCutoff(now) } },
  });
  return res.count;
}
