// Giorni di calendario in Europe/Rome, indipendenti dal fuso del server.

const ROME = "Europe/Rome";
const MS_PER_MINUTE = 60 * 1000;

/** Scarto (ms) di Europe/Rome rispetto a UTC nell'istante dato. */
function romeOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return asUtc - Math.floor(at.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/** Giorno (YYYY-MM-DD) di `d` in Europe/Rome. */
export function romeYmd(d: Date): string {
  return new Date(d.getTime() + romeOffsetMs(d)).toISOString().slice(0, 10);
}

/** Istante della mezzanotte di Europe/Rome del giorno `ymd` (YYYY-MM-DD). */
export function romeDayStart(ymd: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const first = new Date(guess.getTime() - romeOffsetMs(guess));
  // Ricalcolo con lo scarto della mezzanotte vera (cambio ora legale).
  return new Date(guess.getTime() - romeOffsetMs(first));
}

/** Istante della mezzanotte di Europe/Rome del giorno successivo a `ymd`. */
export function romeNextDayStart(ymd: string): Date {
  const next = new Date(`${ymd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return romeDayStart(next.toISOString().slice(0, 10));
}

/** Data in Europe/Rome (es. "22/10/2026"). */
export function formatRomeDate(d: Date): string {
  return d.toLocaleDateString("it-IT", {
    timeZone: ROME,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
