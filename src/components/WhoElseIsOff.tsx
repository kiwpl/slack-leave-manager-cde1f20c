import { useEffect, useState } from "react";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { isDayOff } from "@/lib/holidays";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

/**
 * Shows a manager who else is off (approved or waiting for approval) on the
 * days of the vacation request they are looking at, so they can decide with
 * the team's coverage in front of them.
 */

interface WhoElseIsOffProps {
  requestId: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface OtherRequest {
  id: string;
  employeeId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

// Statuses that mean the person is (or may be) away. A cancellation that is
// only requested is still approved until a manager agrees to it.
const OFF_STATUSES = ["approved", "pending_approval", "cancel_requested"] as const;

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function shortDate(iso: string): string {
  return format(parseISO(iso), "MMM d");
}

function joinAnd(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function Initials({ name, pending }: { name: string; pending: boolean }) {
  return (
    <span
      title={name}
      className={cn(
        "h-6 w-6 shrink-0 rounded-full inline-flex items-center justify-center text-[10px] font-semibold",
        pending ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"
      )}
    >
      {initials(name)}
    </span>
  );
}

export default function WhoElseIsOff({
  requestId, employeeId, employeeName, startDate, endDate, status,
}: WhoElseIsOffProps) {
  const [others, setOthers] = useState<OtherRequest[] | null>(null);
  const [teamSize, setTeamSize] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadError(false);
      const { data: rows, error } = await supabase
        .from("time_off_requests")
        .select("id, employee_id, start_date, end_date, status")
        .eq("request_type", "vacation")
        .in("status", [...OFF_STATUSES])
        .neq("id", requestId)
        .neq("employee_id", employeeId)
        .lte("start_date", endDate)
        .gte("end_date", startDate);

      if (error) {
        console.error("Who else is off: request lookup failed", error);
        if (!cancelled) setLoadError(true);
        return;
      }

      const ids = [...new Set((rows ?? []).map((r) => r.employee_id))];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        if (profileError) console.error("Who else is off: name lookup failed", profileError);
        for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || "");
      }

      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");

      if (cancelled) return;
      setTeamSize(count ?? null);
      // A person with two identical requests (same dates, same status) is shown once.
      const seenKeys = new Set<string>();
      setOthers(
        (rows ?? [])
          .filter((r) => r.start_date && r.end_date)
          .filter((r) => {
            const key = `${r.employee_id}|${r.start_date}|${r.end_date}|${r.status}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          })
          .map((r) => ({
            id: r.id,
            employeeId: r.employee_id,
            name: names.get(r.employee_id) || `Unknown employee (id ${r.employee_id.slice(0, 8)})`,
            startDate: r.start_date as string,
            endDate: r.end_date as string,
            status: r.status,
          }))
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
      );
    };

    load();
    return () => { cancelled = true; };
  }, [requestId, employeeId, startDate, endDate]);

  const thisPending = status === "pending_approval";
  const thisName = employeeName || "This employee";

  // One entry per weekday of this request, with everyone off that day.
  let days: { iso: string; date: Date; people: { name: string; pending: boolean }[] }[] = [];
  try {
    days = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
      .filter((d) => !isDayOff(d))
      .map((d) => {
        const iso = format(d, "yyyy-MM-dd");
        const seen = new Set<string>([employeeId]);
        const people = [{ name: thisName, pending: thisPending }];
        for (const o of others ?? []) {
          if (o.startDate <= iso && o.endDate >= iso && !seen.has(o.employeeId)) {
            seen.add(o.employeeId);
            people.push({ name: o.name, pending: o.status === "pending_approval" });
          }
        }
        return { iso, date: d, people };
      });
  } catch {
    days = [];
  }

  const most = days.length ? Math.max(...days.map((d) => d.people.length)) : 0;
  const busiest = days.filter((d) => d.people.length === most).map((d) => shortDate(d.iso));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Who else is off
        </CardTitle>
        <CardDescription>
          Approved and pending vacation from {shortDate(startDate)} to {shortDate(endDate)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-sm text-destructive">Could not load who else is off. Please refresh to try again.</p>
        ) : others === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {days.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                {days.map((d) => (
                  <div
                    key={d.iso}
                    className="rounded-md border border-border p-2 min-w-0 flex items-center gap-3 sm:block sm:text-center"
                  >
                    <div className="w-14 shrink-0 sm:w-auto">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">{format(d.date, "EEE")}</p>
                      <p className="text-sm font-medium text-foreground">{shortDate(d.iso)}</p>
                    </div>
                    <div className="flex flex-1 flex-wrap gap-1 sm:justify-center sm:mt-2">
                      {d.people.map((p, i) => (
                        <Initials key={`${p.name}-${i}`} name={p.name} pending={p.pending} />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums shrink-0 sm:mt-1">{d.people.length} off</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary/60" />
                Approved
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-warning" />
                Pending
              </span>
            </div>

            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one else has vacation booked or waiting for approval on these days.
              </p>
            ) : (
              <div className="space-y-2">
                {others.map((o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Initials name={o.name} pending={o.status === "pending_approval"} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{o.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Vacation · {shortDate(o.startDate)} → {shortDate(o.endDate)}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                ))}
              </div>
            )}

            {days.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Busiest:{" "}
                <strong className="text-foreground">
                  {most}{teamSize ? ` of ${teamSize}` : ""} {most === 1 ? "person" : "people"}
                </strong>{" "}
                off on {joinAnd(busiest)}
                {thisPending ? " if you approve this one" : ""}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
