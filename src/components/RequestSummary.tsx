import { format, differenceInCalendarDays, parseISO } from "date-fns";

interface RequestSummaryProps {
  requestType: "vacation" | "sick" | "";
  startDate: string;
  endDate: string;
  sickDate: string;
  dayPortion: "full" | "am" | "pm";
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMMM d, yyyy");
  } catch {
    return dateStr;
  }
}

export default function RequestSummary({
  requestType,
  startDate,
  endDate,
  sickDate,
  dayPortion,
}: RequestSummaryProps) {
  const getSummary = (): string => {
    if (!requestType) return "Please complete the form to see your request summary.";

    if (requestType === "vacation") {
      if (dayPortion === "am" && startDate) {
        return `You will take the morning off on ${formatDate(startDate)}.`;
      }
      if (dayPortion === "pm" && startDate) {
        return `You will take the afternoon off on ${formatDate(startDate)}.`;
      }
      if (!startDate || !endDate) return "Please complete the form to see your request summary.";
      if (startDate === endDate) {
        return `You will take 1 full day off on ${formatDate(startDate)}.`;
      }
      const days = differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
      if (days < 1) return "Please complete the form to see your request summary.";
      return `You will take vacation from ${formatDate(startDate)} to ${formatDate(endDate)} (${days} days).`;
    }

    if (requestType === "sick") {
      if (!sickDate) return "Please complete the form to see your request summary.";
      if (dayPortion === "am") {
        return `You were sick in the morning on ${formatDate(sickDate)}.`;
      }
      if (dayPortion === "pm") {
        return `You were sick in the afternoon on ${formatDate(sickDate)}.`;
      }
      return `You were sick on ${formatDate(sickDate)}.`;
    }

    return "Please complete the form to see your request summary.";
  };

  return (
    <div className="p-3 rounded-lg bg-accent/50 border border-border">
      <p className="text-sm text-foreground">{getSummary()}</p>
    </div>
  );
}
