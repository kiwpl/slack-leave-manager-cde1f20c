import { addMonths, eachDayOfInterval, format, parseISO, startOfQuarter } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isDayOff } from "@/lib/holidays";
import type { Tables } from "@/integrations/supabase/types";

/**
 * "Your time off in <year>": vacation days used, booked and waiting for
 * approval, sick days used, and this quarter's flexible time. There is no
 * yearly vacation limit yet (managers decide), so it shows totals, not a
 * "days left" number.
 */

type Request = Tables<"time_off_requests">;

export interface FlexLite {
  status: string;
  submitted_at: string;
}

/** Each working day a request takes, with 0.5 for a half day. Weekends and stat holidays are skipped. */
export function dayAmounts(
  start: string,
  end: string,
  startPortion: string | null | undefined,
  endPortion: string | null | undefined
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  try {
    const same = start === end;
    for (const d of eachDayOfInterval({ start: parseISO(start), end: parseISO(end) })) {
      if (isDayOff(d)) continue;
      const iso = format(d, "yyyy-MM-dd");
      let amount = 1;
      if (same) {
        amount = startPortion === "pm" || endPortion === "am" ? 0.5 : 1;
      } else {
        if (iso === start && startPortion === "pm") amount -= 0.5;
        if (iso === end && endPortion === "am") amount -= 0.5;
      }
      out.push({ date: iso, amount });
    }
  } catch {
    /* bad dates count as nothing */
  }
  return out;
}

/** Vacation used / booked / waiting and sick days for one calendar year. */
export function yearTotals(requests: Request[], year: number, today: string) {
  const t = { used: 0, booked: 0, waiting: 0, sick: 0 };
  for (const r of requests) {
    const start = r.start_date || r.sick_date;
    if (!start) continue;
    const end = r.end_date || start;
    const approved = r.status === "approved" || r.status === "cancel_requested";
    const waiting = r.status === "pending_approval";
    if (!approved && !waiting) continue;
    for (const { date, amount } of dayAmounts(start, end, r.start_day_portion, r.end_day_portion)) {
      if (!date.startsWith(`${year}-`)) continue;
      if (r.request_type === "sick") {
        if (approved) t.sick += amount;
      } else if (waiting) {
        t.waiting += amount;
      } else if (date < today) {
        t.used += amount;
      } else {
        t.booked += amount;
      }
    }
  }
  return t;
}

export function fmtDays(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

export default function TimeOffSummaryCard({
  requests,
  flexRequests,
  today,
}: {
  requests: Request[];
  flexRequests: FlexLite[];
  today: string;
}) {
  const year = Number(today.slice(0, 4));
  const t = yearTotals(requests, year, today);
  const vacationTotal = t.used + t.booked + t.waiting;

  // The flexible time limit is one request per calendar quarter, counted by
  // when it was submitted (same rule the database enforces).
  const qStart = startOfQuarter(parseISO(today));
  const qFrom = format(qStart, "yyyy-MM-dd");
  const qTo = format(addMonths(qStart, 3), "yyyy-MM-dd");
  const flexThisQuarter = flexRequests.filter(
    (f) => f.submitted_at >= qFrom && f.submitted_at < qTo && f.status !== "cancelled" && f.status !== "rejected"
  ).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Your time off in {year}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Vacation</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              <span className="text-2xl font-bold text-foreground">{fmtDays(vacationTotal)}</span>{" "}
              {vacationTotal === 1 ? "day" : "days"} this year
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <Dot className="bg-primary" label={`Used ${fmtDays(t.used)}`} />
            <Dot className="bg-primary/40" label={`Booked ${fmtDays(t.booked)}`} />
            {t.waiting > 0 && <Dot className="bg-warning/70" label={`Waiting for approval ${fmtDays(t.waiting)}`} />}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Sick days</p>
            <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{fmtDays(t.sick)}</p>
            <p className="text-xs text-muted-foreground">used this year</p>
          </div>
          <div className="rounded-lg border border-border p-3 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Flexible time</p>
            <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{flexThisQuarter} of 1</p>
            <p className="text-xs text-muted-foreground">used this quarter</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
