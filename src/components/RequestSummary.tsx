import { format, parseISO, eachDayOfInterval, isWeekend, addDays } from "date-fns";

interface RequestSummaryProps {
  requestType: "vacation" | "sick" | "";
  startDate: string;
  endDate: string;
  startDayPortion: "full" | "am" | "pm";
  endDayPortion: "full" | "am" | "pm";
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMMM d, yyyy");
  } catch {
    return dateStr;
  }
}

export function countBusinessDays(start: string, end: string): number {
  try {
    const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) });
    return days.filter((d) => !isWeekend(d)).length;
  } catch {
    return 0;
  }
}

export function calcTotal(businessDays: number, startPortion: string, endPortion: string, sameDay: boolean): number {
  let total = businessDays;
  if (sameDay) {
    // For same day, either portion being half makes it 0.5
    if (startPortion !== "full" || endPortion !== "full") return 0.5;
    return 1;
  }
  if (startPortion !== "full") total -= 0.5;
  if (endPortion !== "full") total -= 0.5;
  return total;
}

function portionLabel(portion: string): string {
  if (portion === "am") return "morning";
  if (portion === "pm") return "afternoon";
  return "";
}

function getReturnDate(endDate: string, endPortion: string): string {
  try {
    const end = parseISO(endDate);
    if (endPortion === "am") {
      // Taking morning off, back in the afternoon of same day
      return `the afternoon of ${format(end, "MMMM d")}`;
    }
    // Full day or afternoon off — return next business day
    let next = addDays(end, 1);
    while (isWeekend(next)) next = addDays(next, 1);
    return format(next, "MMMM d, yyyy");
  } catch {
    return "";
  }
}

export default function RequestSummary({
  requestType,
  startDate,
  endDate,
  startDayPortion,
  endDayPortion,
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
        if (startDayPortion === "am" || endDayPortion === "am")
          return `You will take the morning off on ${formatDate(startDate)}.`;
        if (startDayPortion === "pm" || endDayPortion === "pm")
          return `You will take the afternoon off on ${formatDate(startDate)}.`;
        return `You will take 1 full day off on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion !== "full" ? ` (${portionLabel(startDayPortion)} only)` : "";
      const endNote = endDayPortion !== "full" ? ` (${portionLabel(endDayPortion)} only)` : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;
      const returnInfo = getReturnDate(endDate, endDayPortion);

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
        if (startDayPortion === "am" || endDayPortion === "am")
          return `You were sick in the morning on ${formatDate(startDate)}.`;
        if (startDayPortion === "pm" || endDayPortion === "pm")
          return `You were sick in the afternoon on ${formatDate(startDate)}.`;
        return `You were sick on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion !== "full" ? ` (${portionLabel(startDayPortion)} only)` : "";
      const endNote = endDayPortion !== "full" ? ` (${portionLabel(endDayPortion)} only)` : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;

      return `You were sick from ${formatDate(startDate)}${startNote} to ${formatDate(end)}${endNote} (${dayLabel}).`;
    }

    return incomplete;
  };

  return (
    <div className="p-3 rounded-lg bg-accent/50 border border-border">
      <p className="text-sm text-foreground">{getSummary()}</p>
    </div>
  );
}
