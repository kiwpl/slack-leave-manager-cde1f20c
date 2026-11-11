import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isDayOff } from "@/lib/holidays";

/**
 * Team limits on the vacation request form: blocked dates set by an admin,
 * and days where the most people allowed off at once are already off.
 * Admins choose whether that only warns (manager decides) or blocks submitting.
 */

export interface BlockedRange {
  start_date: string;
  end_date: string;
  reason: string;
}

export interface TeamLimitCheck {
  mode: "warn" | "block";
  max: number | null;
  blocked: BlockedRange[];
  fullDays: { day: string; people: number }[];
  hasIssues: boolean;
}

const EMPTY: TeamLimitCheck = { mode: "warn", max: null, blocked: [], fullDays: [], hasIssues: false };

/** "Dec 14 – Dec 18, 2026", "Dec 28, 2026 – Jan 2, 2027" or "Dec 14, 2026". */
export function formatRange(start: string, end: string): string {
  const s = parseISO(start);
  const e = parseISO(end);
  if (start === end) return format(s, "MMM d, yyyy");
  if (s.getFullYear() === e.getFullYear()) return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
  return `${format(s, "MMM d, yyyy")} – ${format(e, "MMM d, yyyy")}`;
}

function joinAnd(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Looks up blocked dates and how full the team is for a vacation's dates. */
export function useTeamLimitCheck(start: string, end: string): TeamLimitCheck {
  const [check, setCheck] = useState<TeamLimitCheck>(EMPTY);

  useEffect(() => {
    if (!start || !end || start > end) {
      setCheck(EMPTY);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const [{ data: settings }, { data: blocked, error: blockedError }] = await Promise.all([
        supabase.from("app_settings").select("key, value").in("key", ["team_limit_max", "team_limit_mode"]),
        supabase
          .from("blocked_dates")
          .select("start_date, end_date, reason")
          .lte("start_date", end)
          .gte("end_date", start)
          .order("start_date"),
      ]);

      const maxValue = parseInt(settings?.find((s) => s.key === "team_limit_max")?.value ?? "", 10);
      const max = maxValue > 0 ? maxValue : null;
      const mode = settings?.find((s) => s.key === "team_limit_mode")?.value === "block" ? "block" : "warn";

      let fullDays: { day: string; people: number }[] = [];
      if (max) {
        const { data: counts, error } = await supabase.rpc("people_off_per_day", { _start: start, _end: end });
        if (error) console.error("Team limits: could not count people off", error);
        fullDays = (counts ?? []).filter((c) => c.people >= max && !isDayOff(parseISO(c.day)));
      }

      if (blockedError) console.error("Team limits: could not load blocked dates", blockedError);
      const blockedList = blockedError ? [] : blocked ?? [];

      if (!cancelled) {
        setCheck({ mode, max, blocked: blockedList, fullDays, hasIssues: blockedList.length > 0 || fullDays.length > 0 });
      }
    };

    load();
    return () => { cancelled = true; };
  }, [start, end]);

  return check;
}

export default function TeamLimitsAlert({ check }: { check: TeamLimitCheck }) {
  if (!check.hasIssues) return null;

  const lines: React.ReactNode[] = check.blocked.map((b, i) => (
    <p key={`b-${i}`}>
      <strong>{formatRange(b.start_date, b.end_date)} is blocked:</strong> {b.reason}.
    </p>
  ));
  if (check.fullDays.length && check.max) {
    const most = Math.max(...check.fullDays.map((d) => d.people));
    const days = joinAnd(check.fullDays.map((d) => format(parseISO(d.day), "MMM d")));
    lines.push(
      <p key="full">
        {most} {most === 1 ? "person is" : "people are"} already off on {days}. The team limit is {check.max} off at once.
      </p>
    );
  }
  const block = check.mode === "block";
  lines.push(
    <p key="tail">{block ? "Pick other dates to submit." : "You can still submit, but your manager may decline it."}</p>
  );

  return block ? (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="space-y-2">{lines}</AlertDescription>
    </Alert>
  ) : (
    <Alert className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
      <AlertTriangle className="h-4 w-4 text-yellow-600" />
      <AlertDescription className="text-yellow-800 dark:text-yellow-200 space-y-2">{lines}</AlertDescription>
    </Alert>
  );
}
