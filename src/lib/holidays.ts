import { addDays, format, isWeekend, parseISO } from "date-fns";

/**
 * Ontario statutory (public) holidays, worked out for any year so nobody has
 * to keep a list up to date. A holiday that falls on a weekend is moved to the
 * next weekday that is not already a holiday (its "observed" day), e.g. in 2026
 * Boxing Day (Sat Dec 26) is observed on Mon Dec 28.
 *
 * Mirrored in supabase/functions/send-slack-notification and
 * supabase/functions/post-out-today. Keep them in step.
 */

export interface Holiday {
  date: string; // "YYYY-MM-DD", the day people are off
  name: string;
  observed: boolean; // true when moved off a weekend
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** The nth given weekday (0 = Sunday … 6 = Saturday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

const cache = new Map<number, Holiday[]>();

export function ontarioHolidays(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;

  const victoria = new Date(year, 4, 24); // Monday before May 25
  while (victoria.getDay() !== 1) victoria.setDate(victoria.getDate() - 1);

  const actual: { date: Date; name: string }[] = [
    { date: new Date(year, 0, 1), name: "New Year's Day" },
    { date: nthWeekday(year, 1, 1, 3), name: "Family Day" },
    { date: addDays(easterSunday(year), -2), name: "Good Friday" },
    { date: victoria, name: "Victoria Day" },
    { date: new Date(year, 6, 1), name: "Canada Day" },
    { date: nthWeekday(year, 8, 1, 1), name: "Labour Day" },
    { date: nthWeekday(year, 9, 1, 2), name: "Thanksgiving" },
    { date: new Date(year, 11, 25), name: "Christmas Day" },
    { date: new Date(year, 11, 26), name: "Boxing Day" },
  ];

  // Weekday holidays keep their own date first, then weekend ones move to the
  // next weekday that is still free.
  const taken = new Set<string>();
  const out: Holiday[] = [];
  for (const h of actual) {
    if (!isWeekend(h.date)) {
      taken.add(iso(h.date));
      out.push({ date: iso(h.date), name: h.name, observed: false });
    }
  }
  for (const h of actual) {
    if (isWeekend(h.date)) {
      let d = addDays(h.date, 1);
      while (isWeekend(d) || taken.has(iso(d))) d = addDays(d, 1);
      taken.add(iso(d));
      out.push({ date: iso(d), name: h.name, observed: true });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, out);
  return out;
}

export function holidayOn(dateIso: string): Holiday | undefined {
  const year = Number(dateIso.slice(0, 4));
  if (!year) return undefined;
  return ontarioHolidays(year).find((h) => h.date === dateIso);
}

/** Weekend or stat holiday: not a working day. */
export function isDayOff(d: Date): boolean {
  return isWeekend(d) || !!holidayOn(iso(d));
}

/** "Christmas Day (Dec 25)" or "Boxing Day (observed, Dec 28)". */
export function holidayLabel(h: Holiday): string {
  const day = format(parseISO(h.date), "MMM d");
  return h.observed ? `${h.name} (observed, ${day})` : `${h.name} (${day})`;
}

/** Stat holidays that fall between start and end (inclusive). */
export function holidaysBetween(start: string, end: string): Holiday[] {
  try {
    const s = parseISO(start);
    const e = parseISO(end);
    if (s > e) return [];
    const out: Holiday[] = [];
    for (let y = s.getFullYear(); y <= e.getFullYear(); y++) {
      for (const h of ontarioHolidays(y)) if (h.date >= start && h.date <= end) out.push(h);
    }
    return out;
  } catch {
    return [];
  }
}
