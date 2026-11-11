import { format, parseISO, eachDayOfInterval, addDays } from "date-fns";
import { holidayLabel, holidayOn, holidaysBetween, isDayOff, type Holiday } from "@/lib/holidays";

interface RequestSummaryProps {
  requestType: "vacation" | "sick" | "";
  startDate: string;
  endDate: string;
  startDayPortion: "full" | "pm";
  endDayPortion?: "full" | "am";
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMMM d, yyyy");
  } catch {
    return dateStr;
  }
}

/** Working days from start to end: weekends and Ontario stat holidays don't count. */
export function countBusinessDays(start: string, end: string): number {
  try {
    const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) });
    return days.filter((d) => !isDayOff(d)).length;
  } catch {
    return 0;
  }
}

export function calcTotal(businessDays: number, startPortion: string, endPortion?: string, sameDay?: boolean): number {
  let total = businessDays;
  if (sameDay) {
    if (startPortion === "pm" || endPortion === "am") return 0.5;
    return 1;
  }
  if (startPortion === "pm") total -= 0.5;
  if (endPortion === "am") total -= 0.5;
  return total;
}

function getReturnDate(endDate: string): string {
  try {
    const end = parseISO(endDate);
    let next = addDays(end, 1);
    while (isDayOff(next)) next = addDays(next, 1);
    return format(next, "MMMM d, yyyy");
  } catch {
    return "";
  }
}

/** Stat holidays between the last day off and the return date. */
function holidaysSkippedAfter(endDate: string): Holiday[] {
  const out: Holiday[] = [];
  try {
    let next = addDays(parseISO(endDate), 1);
    while (isDayOff(next)) {
      const h = holidayOn(format(next, "yyyy-MM-dd"));
      if (h) out.push(h);
      next = addDays(next, 1);
    }
  } catch {
    /* ignore bad dates */
  }
  return out;
}

function joinAnd(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export default function RequestSummary({
  requestType,
  startDate,
  endDate,
  startDayPortion,
  endDayPortion = "full",
}: RequestSummaryProps) {
  const incomplete = "Please complete the form to see your request summary.";

  const getSummary = (): string => {
    if (!requestType) return incomplete;

    if (requestType === "vacation") {
      if (!startDate || !endDate) return incomplete;
      const biz = countBusinessDays(startDate, endDate);
      if (biz === 0) return incomplete;

      const sameDay = startDate === endDate;
      const total = calcTotal(biz, startDayPortion, endDayPortion, sameDay);

      if (sameDay) {
        if (startDayPortion === "pm")
          return `You will take the afternoon off on ${formatDate(startDate)}.`;
        if (endDayPortion === "am")
          return `You will take the morning off on ${formatDate(startDate)}.`;
        return `You will take 1 full day off on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion === "pm" ? " (afternoon only)" : "";
      const endNote = endDayPortion === "am" ? " (morning only)" : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;
      const returnInfo = endDayPortion === "am" ? `${formatDate(endDate)} (afternoon)` : getReturnDate(endDate);

      return `You will take vacation from ${formatDate(startDate)}${startNote} to ${formatDate(endDate)}${endNote} (${dayLabel}). You return on ${returnInfo}.`;
    }

    if (requestType === "sick") {
      if (!startDate) return incomplete;
      const end = endDate || startDate;
      const biz = countBusinessDays(startDate, end);
      if (biz === 0) return incomplete;

      const sameDay = startDate === end;
      const total = calcTotal(biz, startDayPortion, endDayPortion, sameDay);

      if (sameDay) {
        if (startDayPortion === "pm")
          return `You were sick in the afternoon on ${formatDate(startDate)}.`;
        if (endDayPortion === "am")
          return `You were sick in the morning on ${formatDate(startDate)}.`;
        return `You were sick on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion === "pm" ? " (afternoon only)" : "";
      const endNote = endDayPortion === "am" ? " (morning only)" : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;

      return `You were sick from ${formatDate(startDate)}${startNote} to ${formatDate(end)}${endNote} (${dayLabel}).`;
    }

    return incomplete;
  };

  // Vacation only: say which stat holidays were left out, and which ones the
  // return date jumps over.
  const getHolidayNote = (): string => {
    if (requestType !== "vacation" || !startDate || !endDate || startDate > endDate) return "";
    const parts: string[] = [];
    const inside = holidaysBetween(startDate, endDate);
    if (inside.length) parts.push(`Not counted as days off: ${joinAnd(inside.map(holidayLabel))}.`);
    const skipped = endDayPortion === "am" ? [] : holidaysSkippedAfter(endDate);
    if (skipped.length) parts.push(`Your return date skips ${joinAnd(skipped.map(holidayLabel))}.`);
    return parts.join(" ");
  };

  const holidayNote = getHolidayNote();

  return (
    <div className="p-3 rounded-lg bg-accent/50 border border-border">
      <p className="text-sm text-foreground">{getSummary()}</p>
      {holidayNote && <p className="text-sm text-muted-foreground mt-1">{holidayNote}</p>}
    </div>
  );
}
