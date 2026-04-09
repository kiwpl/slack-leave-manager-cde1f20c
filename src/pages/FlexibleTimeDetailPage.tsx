import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle2, Info, XCircle } from "lucide-react";

interface FlexRequest {
  id: string;
  employee_id: string;
  date_off: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  makeup_plan: string;
  status: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  rejected_at: string | null;
  rejected_by_user_id: string | null;
  rejection_reason: string | null;
  submitted_at: string;
  pay_period_start: string;
  pay_period_end: string;
  google_calendar_event_id: string | null;
}

interface MakeupEntry {
  id: string;
  makeup_date: string;
  start_time: string;
  end_time: string;
  hours: number;
  completed: boolean;
  google_calendar_event_id: string | null;
}

export default function FlexibleTimeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isManager, isAdmin } = useAuth();

  const [request, setRequest] = useState<FlexRequest | null>(null);
  const [entries, setEntries] = useState<MakeupEntry[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    const [reqRes, entriesRes, logsRes] = await Promise.all([
      supabase.from("flexible_time_requests").select("*").eq("id", id).single(),
      supabase.from("flexible_time_makeup_entries").select("*").eq("request_id", id).order("makeup_date"),
      supabase.from("audit_logs").select("*").eq("request_id", id).order("created_at", { ascending: true }),
    ]);

    if (reqRes.data) {
      setRequest(reqRes.data as any);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", reqRes.data.employee_id)
        .single();
      setEmployeeName(profile?.full_name || "Unknown");
    }
    setEntries((entriesRes.data || []) as any);
    setAuditLogs(logsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const canApprove = (isManager || isAdmin) && request?.status === "pending_approval";

  const handleApprove = async () => {
    if (!request || !user) return;
    setProcessing(true);

    await supabase
      .from("flexible_time_requests")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by_user_id: user.id,
      })
      .eq("id", request.id);

    await supabase.from("audit_logs").insert({
      request_id: request.id,
      action_type: "flexible_time_approved",
      actor_type: "manager",
      actor_id: user.id,
    });

    // Calendar sync
    supabase.functions.invoke("sync-google-calendar", {
      body: { flexible_time_request_id: request.id, action: "create" },
    });

    // Notify employee
    supabase.functions.invoke("send-slack-notification", {
      body: {
        request_id: request.id,
        notification_type: "flexible_time_approved",
        flexible_time: true,
      },
    });

    toast.success("Request approved.");
    fetchData();
    setProcessing(false);
  };

  const handleReject = async () => {
    if (!request || !user) return;
    setProcessing(true);

    await supabase
      .from("flexible_time_requests")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by_user_id: user.id,
        rejection_reason: rejectionReason || "Rejected by manager",
      })
      .eq("id", request.id);

    await supabase.from("audit_logs").insert({
      request_id: request.id,
      action_type: "flexible_time_rejected",
      actor_type: "manager",
      actor_id: user.id,
      details: { rejection_reason: rejectionReason },
    });

    supabase.functions.invoke("send-slack-notification", {
      body: {
        request_id: request.id,
        notification_type: "flexible_time_rejected",
        flexible_time: true,
        extra: { rejection_reason: rejectionReason },
      },
    });

    toast.success("Request rejected.");
    setRejectOpen(false);
    fetchData();
    setProcessing(false);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </AppLayout>
    );
  }

  if (!request) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <p className="text-muted-foreground">Request not found.</p>
        </div>
      </AppLayout>
    );
  }

  const flexStatus = request.status as any;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Flexible Time Request</CardTitle>
              <StatusBadge status={flexStatus} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Employee</p>
                <p className="font-medium text-foreground">{employeeName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Date Off</p>
                <p className="font-medium text-foreground">{request.date_off}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Time</p>
                <p className="font-medium text-foreground">
                  {request.start_time?.slice(0, 5)} – {request.end_time?.slice(0, 5)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Hours</p>
                <p className="font-medium text-foreground">{request.total_hours}h</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">Pay Period</p>
                <p className="font-medium text-foreground">
                  {request.pay_period_start} → {request.pay_period_end}
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-1">Make-Up Plan</p>
              <p className="text-sm text-foreground bg-muted/50 p-3 rounded-lg">
                {request.makeup_plan}
              </p>
            </div>

            {request.rejection_reason && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Rejection Reason</p>
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                  {request.rejection_reason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pay-period reminder */}
        <Alert className="border-primary/30 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            All make-up time must be completed within the same pay period ({request.pay_period_start} → {request.pay_period_end}).
          </AlertDescription>
        </Alert>

        {/* Make-up entries */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Make-Up Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {entry.makeup_date}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.start_time?.slice(0, 5)} – {entry.end_time?.slice(0, 5)} · {entry.hours}h
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      entry.completed
                        ? "bg-success/15 text-success border-success/30"
                        : "bg-muted text-muted-foreground border-border"
                    }
                  >
                    {entry.completed ? "Completed" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Manager actions */}
        {canApprove && (
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={handleApprove}
              disabled={processing}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => setRejectOpen(true)}
              disabled={processing}
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
          </div>
        )}

        {/* Audit log */}
        {auditLogs.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="text-sm">
                    <span className="text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    {" · "}
                    <span className="text-foreground">
                      {log.action_type.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reject dialog */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Label>Reason (optional)</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Provide a reason..."
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={processing}
              >
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
