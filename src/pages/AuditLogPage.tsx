import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";
import { auditNote, auditSentence, type AuditRequestInfo } from "@/lib/auditLog";

type AuditLog = Tables<"audit_logs">;

/** Who the people are and what each request is, so entries can be read as sentences. */
interface Lookups {
  names: Map<string, string>;
  requests: Map<string, AuditRequestInfo>;
}

const NO_LOOKUPS: Lookups = { names: new Map(), requests: new Map() };

/**
 * An audit log row only holds ids. This looks up the requests they point at
 * (vacation / sick day or flexible time) and the names of everyone involved.
 * A lookup that fails is logged and left out: the entry then falls back to
 * "A manager" or "a request" instead of a name.
 */
async function loadLookups(rows: AuditLog[]): Promise<Lookups> {
  const names = new Map<string, string>();
  const requests = new Map<string, AuditRequestInfo>();
  const requestIds = [...new Set(rows.map((r) => r.request_id).filter((id): id is string => !!id))];

  let timeOff: Pick<
    Tables<"time_off_requests">,
    "id" | "employee_id" | "request_type" | "start_date" | "end_date" | "sick_date" | "start_day_portion" | "end_day_portion"
  >[] = [];
  let flex: Pick<Tables<"flexible_time_requests">, "id" | "employee_id" | "date_off" | "start_time" | "end_time" | "total_hours">[] = [];

  if (requestIds.length > 0) {
    // A request id belongs to one of two tables, so both are asked.
    const [timeOffRes, flexRes] = await Promise.all([
      supabase
        .from("time_off_requests")
        .select("id, employee_id, request_type, start_date, end_date, sick_date, start_day_portion, end_day_portion")
        .in("id", requestIds),
      supabase
        .from("flexible_time_requests")
        .select("id, employee_id, date_off, start_time, end_time, total_hours")
        .in("id", requestIds),
    ]);
    if (timeOffRes.error) console.error("Audit log: request lookup failed", timeOffRes.error);
    if (flexRes.error) console.error("Audit log: flexible time lookup failed", flexRes.error);
    timeOff = timeOffRes.data ?? [];
    flex = flexRes.data ?? [];
  }

  const personIds = [
    ...new Set(
      [...rows.map((r) => r.actor_id), ...timeOff.map((r) => r.employee_id), ...flex.map((r) => r.employee_id)].filter(
        (id): id is string => !!id
      )
    ),
  ];
  if (personIds.length > 0) {
    const { data: profiles, error } = await supabase.from("profiles").select("id, full_name, email").in("id", personIds);
    if (error) console.error("Audit log: name lookup failed", error);
    for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || "");
  }

  for (const r of timeOff) {
    const start = r.start_date || r.sick_date;
    if (!start) continue;
    requests.set(r.id, {
      kind: r.request_type === "sick" ? "sick" : "vacation",
      employeeId: r.employee_id,
      ownerName: names.get(r.employee_id) || "",
      start,
      end: r.end_date || start,
      startPortion: r.start_day_portion,
      endPortion: r.end_day_portion,
    });
  }
  for (const r of flex) {
    requests.set(r.id, {
      kind: "flexible",
      employeeId: r.employee_id,
      ownerName: names.get(r.employee_id) || "",
      start: r.date_off,
      end: r.date_off,
      timeFrom: r.start_time?.slice(0, 5),
      timeTo: r.end_time?.slice(0, 5),
      hours: Number(r.total_hours) || 0,
    });
  }

  return { names, requests };
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [lookups, setLookups] = useState<Lookups>(NO_LOOKUPS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (actionFilter !== "all") query = query.eq("action_type", actionFilter);

      const { data } = await query;
      const rows = data || [];
      const found = await loadLookups(rows);
      if (cancelled) return;
      setLogs(rows);
      setLookups(found);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [actionFilter]);

  // Each entry as a sentence and a small line of facts. Search looks through
  // what is shown, so names, dates and reasons can all be found.
  const entries = logs.map((log) => {
    const req = log.request_id ? lookups.requests.get(log.request_id) ?? null : null;
    const actorName = log.actor_id ? lookups.names.get(log.actor_id) || null : null;
    const sentence = auditSentence(log, actorName, req);
    const note = auditNote(log, req);
    return { log, sentence, note, text: `${sentence.map((p) => p.text).join("")} ${note}`.toLowerCase() };
  });

  const s = search.trim().toLowerCase();
  const filtered = s ? entries.filter((e) => e.text.includes(s)) : entries;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          <p className="text-muted-foreground">Complete history of all actions</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="request_submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="request_edited">Edited</SelectItem>
              <SelectItem value="request_cancelled">Cancelled</SelectItem>
              <SelectItem value="cancellation_requested">Cancellation Requested</SelectItem>
              <SelectItem value="cancellation_approved">Cancellation Approved</SelectItem>
              <SelectItem value="cancellation_denied">Cancellation Denied</SelectItem>
              <SelectItem value="sick_day_auto_approved">Auto-Approved</SelectItem>
              <SelectItem value="approved_request_edited">Approved Edited</SelectItem>
              <SelectItem value="rejected_request_resubmitted">Resubmitted</SelectItem>
              <SelectItem value="flexible_time_submitted">Flexible Time Submitted</SelectItem>
              <SelectItem value="flexible_time_approved">Flexible Time Approved</SelectItem>
              <SelectItem value="flexible_time_rejected">Flexible Time Rejected</SelectItem>
              <SelectItem value="flexible_time_completed">Flexible Time Completed</SelectItem>
              <SelectItem value="flexible_time_incomplete">Flexible Time Incomplete</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit logs found.</p>
            ) : (
              <div className="ui-list">
                {filtered.map(({ log, sentence, note }) => (
                  <div
                    key={log.id}
                    className="ui-row flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {sentence.map((part, i) => (
                          <span key={i} className={part.bold ? "font-medium" : undefined}>{part.text}</span>
                        ))}
                      </p>
                      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
