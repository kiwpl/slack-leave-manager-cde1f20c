import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import SpecialApprovalBadge from "@/components/SpecialApprovalBadge";

type Request = Tables<"time_off_requests"> & { employee_name?: string };
type FlexRequest = { id: string; employee_id: string; date_off: string; start_time: string; end_time: string; total_hours: number; status: string; submitted_at: string; employee_name?: string };

export default function ManagerDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<Request[]>([]);
  const [flexRequests, setFlexRequests] = useState<FlexRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending_approval");

  const fetchRequests = async () => {
    setLoading(true);
    let query = supabase
      .from("time_off_requests")
      .select("*")
      .order("submitted_at", { ascending: false });

    if (statusFilter !== "all") query = query.eq("status", statusFilter as any);

    const { data, error } = await query;
    if (error) {
      console.error("Manager dashboard query error:", error);
      setRequests([]);
      setLoading(false);
      return;
    }

    // Fetch employee names separately
    const employeeIds = [...new Set((data || []).map((r) => r.employee_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", employeeIds);

    const nameMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    setRequests(
      (data || []).map((r) => ({ ...r, employee_name: nameMap.get(r.employee_id) || "Unknown" }))
    );

    // Flexible time requests
    let fQuery = supabase
      .from("flexible_time_requests")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (statusFilter !== "all") fQuery = fQuery.eq("status", statusFilter);
    const { data: fData } = await fQuery;

    if (fData && fData.length > 0) {
      const fEmployeeIds = [...new Set(fData.map((r: any) => r.employee_id))];
      const { data: fProfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", fEmployeeIds);
      const fNameMap = new Map((fProfiles || []).map((p) => [p.id, p.full_name]));
      setFlexRequests(fData.map((r: any) => ({ ...r, employee_name: fNameMap.get(r.employee_id) || "Unknown" })));
    } else {
      setFlexRequests([]);
    }

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
              <p className="text-muted-foreground">Review team time off requests (approvals happen in Slack)</p>
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
            ) : requests.length === 0 && flexRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests found.</p>
            ) : (
              <div className="space-y-2">
                {requests.map((req) => (
                  <Link
                    key={req.id}
                    to={`/requests/${req.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">
                          {req.employee_name || "Unknown"}
                        </span>
                        <span className="text-sm text-muted-foreground capitalize">
                          · {req.request_type === "vacation" ? "Vacation" : "Sick Day"}
                        </span>
                        <StatusBadge status={req.status} approvalSource={req.approval_source} />
                        {(req as any).requires_special_approval && <SpecialApprovalBadge />}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {req.request_type === "vacation"
                          ? `${req.start_date} → ${req.end_date}`
                          : req.sick_date}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.submitted_at).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
                {flexRequests.map((req) => (
                  <Link
                    key={req.id}
                    to={`/flexible-time/${req.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">
                          {req.employee_name || "Unknown"}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          · Flexible Time
                        </span>
                        <StatusBadge status={req.status as any} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {req.date_off} · {req.start_time?.slice(0, 5)} – {req.end_time?.slice(0, 5)} · {req.total_hours}h
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.submitted_at).toLocaleDateString()}
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
