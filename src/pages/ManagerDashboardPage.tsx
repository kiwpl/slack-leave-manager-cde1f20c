import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

type Request = Tables<"time_off_requests"> & { profiles?: { full_name: string } };

export default function ManagerDashboardPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending_approval");

  useEffect(() => {
    let query = supabase
      .from("time_off_requests")
      .select("*, profiles!time_off_requests_employee_id_fkey(full_name)")
      .order("submitted_at", { ascending: false });

    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    query.then(({ data }) => {
      setRequests((data as any) || []);
      setLoading(false);
    });
  }, [statusFilter]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Manager Dashboard</h1>
          <p className="text-muted-foreground">Review team time off requests (approvals happen in Slack)</p>
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
              <SelectItem value="all">All Statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : requests.length === 0 ? (
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
                          {(req as any).profiles?.full_name || "Unknown"}
                        </span>
                        <span className="text-sm text-muted-foreground capitalize">
                          · {req.request_type === "vacation" ? "Vacation" : "Sick Day"}
                        </span>
                        <StatusBadge status={req.status} approvalSource={req.approval_source} />
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
