import { format, parseISO, eachDayOfInterval, isWeekend, addDays } from "date-fns";

interface RequestSummaryProps {
  requestType: "vacation" | "sick" | "";
  startDate: string;
  endDate: string;
  startDayPortion: "full" | "pm";
  endDayPortion?: "full";
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

export function calcTotal(businessDays: number, startPortion: string, _endPortion?: string, sameDay?: boolean): number {
  let total = businessDays;
  if (sameDay) {
    if (startPortion === "pm") return 0.5;
    return 1;
  }
  if (startPortion === "pm") total -= 0.5;
  return total;
}

function getReturnDate(endDate: string): string {
  try {
    const end = parseISO(endDate);
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
}: RequestSummaryProps) {
  const incomplete = "Please complete the form to see your request summary.";

  const getSummary = (): string => {
    if (!requestType) return incomplete;

    if (requestType === "vacation") {
      if (!startDate || !endDate) return incomplete;
      const biz = countBusinessDays(startDate, endDate);
      if (biz === 0) return incomplete;

      const sameDay = startDate === endDate;
      const total = calcTotal(biz, startDayPortion, "full", sameDay);

      if (sameDay) {
        if (startDayPortion === "pm")
          return `You will take the afternoon off on ${formatDate(startDate)}.`;
        return `You will take 1 full day off on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion === "pm" ? " (afternoon only)" : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;
      const returnInfo = getReturnDate(endDate);

      return `You will take vacation from ${formatDate(startDate)}${startNote} to ${formatDate(endDate)} (${dayLabel}). You return on ${returnInfo}.`;
    }

    if (requestType === "sick") {
      if (!startDate) return incomplete;
      const end = endDate || startDate;
      const biz = countBusinessDays(startDate, end);
      if (biz === 0) return incomplete;

      const sameDay = startDate === end;
      const total = calcTotal(biz, startDayPortion, "full", sameDay);

      if (sameDay) {
        if (startDayPortion === "pm")
          return `You were sick in the afternoon on ${formatDate(startDate)}.`;
        return `You were sick on ${formatDate(startDate)}.`;
      }

      const startNote = startDayPortion === "pm" ? " (afternoon only)" : "";
      const dayLabel = total === 1 ? "1 business day" : `${total} business days`;

      return `You were sick from ${formatDate(startDate)}${startNote} to ${formatDate(end)} (${dayLabel}).`;
    }

    return incomplete;
  };

  return (
    <div className="p-3 rounded-lg bg-accent/50 border border-border">
      <p className="text-sm text-foreground">{getSummary()}</p>
    </div>
  );
}
