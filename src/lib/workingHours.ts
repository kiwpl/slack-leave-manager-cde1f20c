/**
 * Working-hours maths for flexible time.
 *
 * The office takes an unpaid lunch break from 12:00 to 13:00. Any block of time
 * that crosses it is worth one hour less than the clock suggests: 08:30–13:30 is
 * five hours on the clock but four working hours.
 *
 * Time off and make-up time must both be measured this way, otherwise a make-up
 * block that crosses lunch looks longer than it really is and the employee ends
 * up owing time nobody noticed. Mirrors public.calculate_working_hours() in the
 * database, which is the authority.
 */

export const LUNCH_START_MINUTES = 12 * 60; // 12:00
export const LUNCH_END_MINUTES = 13 * 60; // 13:00
export const LUNCH_LABEL = "12:00–13:00";

export function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Hours of the block that fall inside the lunch break. */
export function getLunchOverlapHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  const overlapStart = Math.max(startMin, LUNCH_START_MINUTES);
  const overlapEnd = Math.min(endMin, LUNCH_END_MINUTES);
  return Math.max(0, overlapEnd - overlapStart) / 60;
}

/** Clock time between start and end, lunch break removed. */
export function calculateWorkingHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const rawMinutes = parseTimeToMinutes(end) - parseTimeToMinutes(start);
  if (rawMinutes <= 0) return 0;
  const lunchOverlapMinutes = getLunchOverlapHours(start, end) * 60;
  return Math.round(((rawMinutes - lunchOverlapMinutes) / 60) * 100) / 100;
}

/** Raw clock time between start and end, lunch break included. */
export function calculateClockHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const diff = (parseTimeToMinutes(end) - parseTimeToMinutes(start)) / 60;
  return Math.max(0, Math.round(diff * 100) / 100);
}

/** "4h" / "3.5h" — trims the trailing ".0" that toFixed would leave behind. */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
}

/**
 * True when a make-up block sits on the same day as the time off and runs
 * during it. Making up time while you are away does not put the hours back.
 */
export function overlapsTimeOff(
  makeupDate: string,
  makeupStart: string,
  makeupEnd: string,
  dateOff: string,
  offStart: string,
  offEnd: string
): boolean {
  if (!makeupDate || !dateOff || makeupDate !== dateOff) return false;
  if (!makeupStart || !makeupEnd || !offStart || !offEnd) return false;
  return (
    parseTimeToMinutes(makeupStart) < parseTimeToMinutes(offEnd) &&
    parseTimeToMinutes(makeupEnd) > parseTimeToMinutes(offStart)
  );
}
