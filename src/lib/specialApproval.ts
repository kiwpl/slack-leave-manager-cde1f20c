import { addDays, format, parseISO, startOfDay } from "date-fns";

/**
 * Returns true when the vacation start_date is within 30 days (inclusive) from today.
 */
export function isWithin30Days(startDate: string): boolean {
  if (!startDate) return false;
  const today = startOfDay(new Date());
  const cutoff = addDays(today, 30);
  const start = startOfDay(parseISO(startDate));
  return start <= cutoff;
}
