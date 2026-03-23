import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import PolicyDisplay from "@/components/PolicyDisplay";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, ClipboardList, Clock, Plus } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Request = Tables<"time_off_requests">;

export default function DashboardPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("time_off_requests")
      .select("*")
      .eq("employee_id", user.id)
      .order("submitted_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setRequests(data || []);
        setLoading(false);
      });
  }, [user]);

  const pending = requests.filter((r) => r.status === "pending_approval").length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const total = requests.length;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">Manage your time off requests</p>
          </div>
          <Button asChild>
            <Link to="/submit-request">
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Link>
          </Button>
        </div>

        <PolicyDisplay />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{approved}</p>
                  <p className="text-xs text-muted-foreground">Approved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ClipboardList className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{total}</p>
                  <p className="text-xs text-muted-foreground">Total Requests</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No requests yet.{" "}
                <Link to="/submit-request" className="text-primary hover:underline">
                  Submit your first request
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <Link
                    key={req.id}
                    to={`/requests/${req.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-sm">
                        <span className="font-medium capitalize text-foreground">
                          {req.request_type === "vacation" ? "Vacation" : "Sick Day"}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          {req.request_type === "vacation"
                            ? `${req.start_date} → ${req.end_date}`
                            : req.sick_date}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={req.status} approvalSource={req.approval_source} />
                  </Link>
                ))}
              </div>
            )}
            {requests.length > 0 && (
              <div className="mt-4">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/my-requests">View all requests →</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
