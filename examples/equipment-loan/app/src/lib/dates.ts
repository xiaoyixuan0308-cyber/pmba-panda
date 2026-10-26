/**
 * Date helpers. Date-only values are 'YYYY-MM-DD' strings handled in UTC so
 * that time zones can never shift a day. Times of day are expressed in the
 * college's local time (Asia/Shanghai, UTC+8) and stored as UTC timestamps.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_OFFSET_HOURS = 8;

export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * DAY_MS));

/** Whole calendar days from a to b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);

/** A local time of day on an ISO date, as a UTC Date for storage. */
export const atLocal = (iso: string, hour: number, minute = 0) =>
  new Date(toDate(iso).getTime() + (hour - LOCAL_OFFSET_HOURS) * 3600_000 + minute * 60_000);

/** The local calendar date of a stored timestamp. */
export const localDateOf = (d: Date) => toIso(new Date(d.getTime() + LOCAL_OFFSET_HOURS * 3600_000));

/** Working days (Mon–Fri) strictly after `from` up to and including `to` (BR-09; holidays ignored). */
export function workingDaysBetween(from: string, to: string) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    const wd = toDate(d).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
