import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Clock } from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";
import SpecialApprovalBadge from "@/components/SpecialApprovalBadge";

type Request = Tables<"time_off_requests">;
type FlexRequest = { id: string; date_off: string; start_time: string; end_time: string; total_hours: number; status: string; submitted_at: string; _type: "flexible" };

export default function MyRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [flexRequests, setFlexRequests] = useState<FlexRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const fetchAll = async () => {
      // Regular requests
      if (typeFilter !== "flexible") {
        let query = supabase
          .from("time_off_requests")
          .select("*")
          .eq("employee_id", user.id)
          .order("submitted_at", { ascending: false });
        if (typeFilter !== "all") query = query.eq("request_type", typeFilter as any);
        if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
        const { data } = await query;
        setRequests(data || []);
      } else {
        setRequests([]);
      }

      // Flexible requests
      if (typeFilter === "all" || typeFilter === "flexible") {
        let fQuery = supabase
          .from("flexible_time_requests")
          .select("*")
          .eq("employee_id", user.id)
          .order("submitted_at", { ascending: false });
        if (statusFilter !== "all") fQuery = fQuery.eq("status", statusFilter);
        const { data: fData } = await fQuery;
        setFlexRequests(
          (fData || []).map((r: any) => ({ ...r, _type: "flexible" as const }))
        );
      } else {
        setFlexRequests([]);
      }

      setLoading(false);
    };

    fetchAll();
  }, [user, typeFilter, statusFilter]);

  // Merge and sort
  const allItems = [
    ...requests.map((r) => ({ ...r, _type: "timeoff" as const, sortDate: r.submitted_at })),
    ...flexRequests.map((r) => ({ ...r, _type: "flexible" as const, sortDate: r.submitted_at })),
  ].sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Requests</h1>
            <p className="text-muted-foreground">View and manage your time off requests</p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/submit-request">
                <Plus className="h-4 w-4 mr-2" />
                New Request
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/submit-flexible-time">
                <Clock className="h-4 w-4 mr-2" />
                Flexible Time
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="vacation">Vacation</SelectItem>
              <SelectItem value="sick">Sick Day</SelectItem>
              <SelectItem value="flexible">Flexible Time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : allItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests found.</p>
            ) : (
              <div className="space-y-2">
                {allItems.map((item) => {
                  if (item._type === "flexible") {
                    const flex = item as any;
                    return (
                      <Link
                        key={flex.id}
                        to={`/flexible-time/${flex.id}`}
                        className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground">Flexible Time</span>
                            <StatusBadge status={flex.status} />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {flex.date_off} · {flex.start_time?.slice(0, 5)} – {flex.end_time?.slice(0, 5)} · {flex.total_hours}h
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(flex.submitted_at).toLocaleDateString()}
                        </span>
                      </Link>
                    );
                  }
                  const req = item as Request & { _type: string; sortDate: string };
                  return (
                    <Link
                      key={req.id}
                      to={`/requests/${req.id}`}
                      className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-foreground capitalize">
                            {req.request_type === "vacation" ? "Vacation" : "Sick Day"}
                          </span>
                          <StatusBadge status={req.status} approvalSource={req.approval_source} />
                          {(req as any).requires_special_approval && <SpecialApprovalBadge />}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {req.request_type === "vacation"
                            ? `${req.start_date}${req.start_day_portion === "pm" ? " (afternoon)" : ""} → ${req.end_date}`
                            : `${req.sick_date || req.start_date}${req.start_day_portion === "pm" ? " (afternoon)" : ""}`}
                          {req.note && ` · ${req.note.substring(0, 50)}${req.note.length > 50 ? "..." : ""}`}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(req.submitted_at).toLocaleDateString()}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
