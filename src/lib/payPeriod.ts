/**
 * Get the bi-weekly pay period that contains the given date,
 * based on a known anchor (start) date of any pay period.
 */
export function getPayPeriod(
  date: Date,
  anchorDate: Date
): { start: Date; end: Date } {
  const msPerDay = 86400000;
  const periodDays = 14;

  // Normalize to midnight UTC
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const anchor = new Date(
    Date.UTC(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
  );

  const diffDays = Math.floor((d.getTime() - anchor.getTime()) / msPerDay);
  // Handle dates before anchor
  const periodIndex = Math.floor(diffDays / periodDays);
  const periodStart = new Date(anchor.getTime() + periodIndex * periodDays * msPerDay);
  const periodEnd = new Date(periodStart.getTime() + (periodDays - 1) * msPerDay);

  return { start: periodStart, end: periodEnd };
}

/** Format a Date to YYYY-MM-DD */
export function formatDateUTC(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Parse YYYY-MM-DD to Date (UTC midnight) */
export function parseDateUTC(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Get ISO week number for a date */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Get week key (year-week) for grouping */
export function getWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return `${d.getUTCFullYear()}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}
