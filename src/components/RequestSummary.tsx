import { format, parseISO, eachDayOfInterval, isWeekend } from "date-fns";

interface RequestSummaryProps {
  requestType: "vacation" | "sick" | "";
  startDate: string;
  endDate: string;
  dayPortion: "full" | "am" | "pm";
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMMM d, yyyy");
  } catch {
    return dateStr;
  }
}

function countBusinessDays(start: string, end: string): number {
  try {
    const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) });
    return days.filter((d) => !isWeekend(d)).length;
  } catch {
    return 0;
  }
}

function formatDayCount(businessDays: number, isHalfDay: boolean): string {
  const total = isHalfDay ? businessDays - 0.5 : businessDays;
  if (total <= 0) return "";
  if (total === 1) return "1 business day";
  if (total % 1 === 0) return `${total} business days`;
  return `${total} business days`;
}

export default function RequestSummary({
  requestType,
  startDate,
  endDate,
  dayPortion,
}: RequestSummaryProps) {
  const incomplete = "Please complete the form to see your request summary.";
  const isHalfDay = dayPortion === "am" || dayPortion === "pm";
  const halfLabel = dayPortion === "am" ? "morning" : "afternoon";

  const getSummary = (): string => {
    if (!requestType) return incomplete;

    if (requestType === "vacation") {
      if (!startDate || !endDate) return incomplete;
      const biz = countBusinessDays(startDate, endDate);
      if (biz === 0) return incomplete;

      const sameDay = startDate === endDate;

      if (sameDay && isHalfDay) {
        return `You will take the ${halfLabel} off on ${formatDate(startDate)}.`;
      }
      if (sameDay) {
        return `You will take 1 business day off on ${formatDate(startDate)}.`;
      }
      const count = formatDayCount(biz, isHalfDay);
      return `You will take vacation from ${formatDate(startDate)} to ${formatDate(endDate)} (${count}).`;
    }

    if (requestType === "sick") {
      if (!startDate) return incomplete;
      const end = endDate || startDate;
      const biz = countBusinessDays(startDate, end);
      if (biz === 0) return incomplete;

      const sameDay = startDate === end;

      if (sameDay && isHalfDay) {
        return `You were sick in the ${halfLabel} on ${formatDate(startDate)}.`;
      }
      if (sameDay) {
        return `You were sick on ${formatDate(startDate)}.`;
      }
      const count = formatDayCount(biz, isHalfDay);
      return `You were sick from ${formatDate(startDate)} to ${formatDate(end)} (${count}).`;
    }

    return incomplete;
  };

  return (
    <div className="p-3 rounded-lg bg-accent/50 border border-border">
      <p className="text-sm text-foreground">{getSummary()}</p>
    </div>
  );
}
