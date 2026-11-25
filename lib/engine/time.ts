// All "as of" logic is in IST (Asia/Kolkata, UTC+05:30, no DST).
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const DAY_MS = 86400000;

/** Parse an ISO timestamp or YYYY-MM-DD (treated as the START of that IST day) to epoch ms. */
export function toMs(iso: string | null | undefined): number {
  if (!iso) return NaN;
  if (iso.length === 10) return Date.parse(`${iso}T00:00:00+05:30`);
  // Postgres may return "2025-04-12 10:00:00+00"; normalise the space.
  return Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T"));
}

/**
 * Resolve an as-of input. A bare date "YYYY-MM-DD" means the END of that day in IST
 * (23:59:59.999 +05:30). A full timestamp is used exactly.
 */
export function resolveAsOf(asOf: string): { ms: number; day: string; label: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    const ms = Date.parse(`${asOf}T23:59:59.999+05:30`);
    if (Number.isNaN(ms)) throw new Error(`Invalid as-of date: ${asOf}`);
    return { ms, day: asOf, label: `end of ${asOf} IST` };
  }
  const ms = toMs(asOf);
  if (Number.isNaN(ms)) throw new Error(`Invalid as-of timestamp: ${asOf}`);
  return { ms, day: istDay(ms), label: `${asOf}` };
}

/** IST calendar day (YYYY-MM-DD) of an epoch ms. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** End of an IST day in epoch ms. */
export function endOfIstDay(day: string): number {
  return Date.parse(`${day}T23:59:59.999+05:30`);
}

export function addDays(day: string, n: number): string {
  return istDay(Date.parse(`${day}T12:00:00+05:30`) + n * DAY_MS);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00+05:30`) - Date.parse(`${fromDay}T12:00:00+05:30`)) / DAY_MS);
}

/** Format epoch ms as an IST ISO string with +05:30 (the source convention). */
export function toIstIso(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}
