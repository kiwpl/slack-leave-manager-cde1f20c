import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import SpecialApprovalBadge from "@/components/SpecialApprovalBadge";

/**
 * Vacation/sick day requests and flexible time requests live in two different
 * tables. They are normalised into one shape here so the page can show a single
 * list ordered by submission date. Rendering them as two separate lists pushed
 * every flexible time request below every vacation request, which made an
 * approved flexible time request look missing when it was only far down the page.
 */
interface DashboardRow {
  id: string;
  href: string;
  employeeName: string;
  typeLabel: string;
  status: string;
  approvalSource: string | null;
  detail: string;
  submittedAt: string;
  requiresSpecialApproval: boolean;
}

/**
 * A request always belongs to somebody. When the name will not resolve, say so
 * in a way that can be followed up, instead of a bare "Unknown" that gives
 * nobody anything to go on.
 */
function resolveName(
  employeeId: string,
  names: Map<string, { full_name: string | null; email: string | null }>
): string {
  const profile = names.get(employeeId);
  if (profile?.full_name) return profile.full_name;
  if (profile?.email) return profile.email;
  return `Unknown employee (id ${employeeId.slice(0, 8)})`;
}

export default function ManagerDashboardPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("pending_approval");

  const fetchRequests = async () => {
    setLoading(true);
    setLoadError(null);

    let timeOffQuery = supabase
      .from("time_off_requests")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (statusFilter !== "all") timeOffQuery = timeOffQuery.eq("status", statusFilter as any);

    let flexQuery = supabase
      .from("flexible_time_requests")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (statusFilter !== "all") flexQuery = flexQuery.eq("status", statusFilter);

    // Run both independently. "Completed" and "Incomplete" are flexible-time-only
    // statuses that the time_off_requests enum rejects, and a failure there used
    // to abort the whole load and hide the flexible time requests as well.
    const [timeOffRes, flexRes] = await Promise.all([timeOffQuery, flexQuery]);

    if (timeOffRes.error) {
      console.error("Manager dashboard: time off query failed", timeOffRes.error);
    }
    if (flexRes.error) {
      console.error("Manager dashboard: flexible time query failed", flexRes.error);
    }
    if (timeOffRes.error && flexRes.error) {
      setRows([]);
      setLoadError("Could not load requests. Please refresh to try again.");
      setLoading(false);
      return;
    }

    const timeOff = timeOffRes.data ?? [];
    const flex = (flexRes.data ?? []) as any[];

    const employeeIds = [
      ...new Set([
        ...timeOff.map((r) => r.employee_id),
        ...flex.map((r) => r.employee_id),
      ]),
    ];

    const names = new Map<string, { full_name: string | null; email: string | null }>();
    if (employeeIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", employeeIds);
      if (profileError) {
        console.error("Manager dashboard: profile lookup failed", profileError);
      }
      for (const profile of profiles ?? []) {
        names.set(profile.id, { full_name: profile.full_name, email: profile.email });
      }
    }

    const timeOffRows: DashboardRow[] = timeOff.map((r) => ({
      id: r.id,
      href: `/requests/${r.id}`,
      employeeName: resolveName(r.employee_id, names),
      typeLabel: r.request_type === "vacation" ? "Vacation" : "Sick Day",
      status: r.status,
      approvalSource: r.approval_source ?? null,
      detail:
        r.request_type === "vacation"
          ? `${r.start_date} → ${r.end_date}`
          : String(r.sick_date ?? ""),
      submittedAt: r.submitted_at,
      requiresSpecialApproval: !!(r as any).requires_special_approval,
    }));

    const flexRows: DashboardRow[] = flex.map((r) => ({
      id: r.id,
      href: `/flexible-time/${r.id}`,
      employeeName: resolveName(r.employee_id, names),
      typeLabel: "Flexible Time",
      status: r.status,
      approvalSource: null,
      detail: `${r.date_off} · ${r.start_time?.slice(0, 5)} – ${r.end_time?.slice(0, 5)} · ${r.total_hours}h`,
      submittedAt: r.submitted_at,
      requiresSpecialApproval: false,
    }));

    setRows(
      [...timeOffRows, ...flexRows].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      )
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Manager Dashboard</h1>
              <p className="text-muted-foreground">
                Review team time off requests. Open a request to approve or reject it,
                or use the buttons in your Slack message.
              </p>
            </div>
            <Button onClick={() => navigate("/manager/submit-for-staff")} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Submit for Staff
            </Button>
          </div>
        </div>

        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests found.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => (
                  <Link
                    key={row.id}
                    to={row.href}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">{row.employeeName}</span>
                        <span className="text-sm text-muted-foreground">· {row.typeLabel}</span>
                        <StatusBadge status={row.status as any} approvalSource={row.approvalSource as any} />
                        {row.requiresSpecialApproval && <SpecialApprovalBadge />}
                      </div>
                      <p className="text-sm text-muted-foreground">{row.detail}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.submittedAt).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
