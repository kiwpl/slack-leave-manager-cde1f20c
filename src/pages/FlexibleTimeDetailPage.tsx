import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { parseDateUTC } from "@/lib/payPeriod";
import { LUNCH_LABEL, formatHours, getLunchOverlapHours } from "@/lib/workingHours";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  cancellation_reason: string | null;
  previous_status: string | null;
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
  const [cancellationReason, setCancellationReason] = useState("");
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
      setEmployeeName(
        profile?.full_name ||
        `Unknown employee (id ${reqRes.data.employee_id.slice(0, 8)})`
      );
    }
    setEntries((entriesRes.data || []) as any);
    setAuditLogs(logsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const canApprove = (isManager || isAdmin) && request?.status === "pending_approval";
  const canCancel =
    request?.employee_id === user?.id &&
    (request?.status === "pending_approval" || request?.status === "approved") &&
    request?.date_off != null &&
    parseDateUTC(request.date_off) > new Date();
  const isCancelRequested = request?.status === "cancel_requested" && request.employee_id === user?.id;

  const handleCancel = async () => {
    if (!request || !user) return;
    setProcessing(true);

    await supabase
      .from("flexible_time_requests")
      .update({
        status: "cancel_requested",
        previous_status: request.status,
        cancelled_by_user_id: user.id,
        cancellation_reason: cancellationReason || null,
      } as any)
      .eq("id", request.id);

    await supabase.from("audit_logs").insert({
      request_id: request.id,
      action_type: "cancellation_requested",
      actor_type: "staff",
      actor_id: user.id,
      details: { reason: cancellationReason || null },
    });

    // Notify managers via Slack — they must approve or deny the cancellation
    try {
      console.log("[cancel] Sending cancel_request_notification to Slack...");
      const { error: slackError } = await supabase.functions.invoke(
        "send-slack-notification",
        {
          body: {
            request_id: request.id,
            notification_type: "cancel_request_notification",
            flexible_time: true,
            extra: { cancellation_reason: cancellationReason || "" },
          },
        }
      );
      if (slackError) {
        console.error("[cancel] Slack notification error:", slackError);
        toast.error("Cancellation logged, but manager notification failed. Please inform your manager directly.");
      } else {
        console.log("[cancel] Slack notification sent successfully.");
        toast.success("Cancellation request submitted. Your manager will be notified via Slack.");
      }
    } catch (err) {
      console.error("[cancel] Slack notification threw:", err);
      toast.error("Cancellation logged, but manager notification failed. Please inform your manager directly.");
    }

    setCancelOpen(false);
    fetchData();
    setProcessing(false);
  };

  const handleApprove = async () => {
    if (!request || !user) return;
    setProcessing(true);

    const { data: approved, error: approveError } = await supabase
      .from("flexible_time_requests")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by_user_id: user.id,
      })
      .eq("id", request.id)
      .select("id");

    if (approveError || !approved || approved.length === 0) {
      toast.error("Could not approve this request: " + (approveError?.message || "no change was saved"));
      setProcessing(false);
      return;
    }

    const { error: logError } = await supabase.from("audit_logs").insert({
      request_id: request.id,
      action_type: "flexible_time_approved",
      actor_type: "manager",
      actor_id: user.id,
      details: { via: "app" },
    });
    if (logError) {
      console.error("[approve] Audit log insert failed:", logError);
      toast.warning("Approved, but the action could not be written to the audit log.");
    }

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

    const { data: rejected, error: rejectError } = await supabase
      .from("flexible_time_requests")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by_user_id: user.id,
        rejection_reason: rejectionReason || "Rejected by manager",
      })
      .eq("id", request.id)
      .select("id");

    if (rejectError || !rejected || rejected.length === 0) {
      toast.error("Could not reject this request: " + (rejectError?.message || "no change was saved"));
      setProcessing(false);
      return;
    }

    const { error: logError } = await supabase.from("audit_logs").insert({
      request_id: request.id,
      action_type: "flexible_time_rejected",
      actor_type: "manager",
      actor_id: user.id,
      details: { via: "app", rejection_reason: rejectionReason },
    });
    if (logError) {
      console.error("[reject] Audit log insert failed:", logError);
      toast.warning("Rejected, but the action could not be written to the audit log.");
    }

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
  const makeupTotal = entries.reduce((sum, e) => sum + Number(e.hours ?? 0), 0);
  const hoursOff = Number(request.total_hours ?? 0);
  const makeupShortfall = Math.round((hoursOff - makeupTotal) * 100) / 100;
  const offLunchHours = getLunchOverlapHours(request.start_time, request.end_time);

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
                <p className="font-medium text-foreground">{formatHours(hoursOff)}</p>
                {offLunchHours > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Clock time is longer &mdash; the {LUNCH_LABEL} lunch break
                    ({formatHours(offLunchHours)}) does not count as working time.
                  </p>
                )}
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
            <div
              className={
                "mb-3 p-3 rounded-lg text-sm " +
                (Math.abs(makeupShortfall) > 0.01
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/50 text-muted-foreground")
              }
            >
              <span className="font-medium">
                {formatHours(makeupTotal)} scheduled of {formatHours(hoursOff)} owed
              </span>
              {makeupShortfall > 0.01 && (
                <span> &mdash; {formatHours(makeupShortfall)} short.</span>
              )}
              {makeupShortfall < -0.01 && (
                <span> &mdash; {formatHours(-makeupShortfall)} more than required.</span>
              )}
              <span className="block text-xs mt-1">
                Working hours only. The {LUNCH_LABEL} lunch break never counts towards
                make-up time.
              </span>
            </div>

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
                      {entry.start_time?.slice(0, 5)} – {entry.end_time?.slice(0, 5)} ·{" "}
                      {formatHours(Number(entry.hours ?? 0))}
                      {getLunchOverlapHours(entry.start_time, entry.end_time) > 0 &&
                        ` (excludes ${formatHours(getLunchOverlapHours(entry.start_time, entry.end_time))} lunch)`}
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

        {/* Employee cancel */}
        {isCancelRequested && (
          <Button variant="outline" disabled className="opacity-60 cursor-not-allowed">
            <XCircle className="h-4 w-4 mr-1" /> Cancellation Requested
          </Button>
        )}
        {canCancel && (
          <Button
            variant="destructive"
            onClick={() => setCancelOpen(true)}
            disabled={processing}
          >
            <XCircle className="h-4 w-4 mr-1" /> Cancel Request
          </Button>
        )}

        {/* Cancel confirmation dialog */}
        <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Request Cancellation?</AlertDialogTitle>
              <AlertDialogDescription>
                Your manager will be notified and must approve or deny the cancellation.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-2">
              <Label>Reason for cancellation (optional)</Label>
              <Textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="Let your manager know why you're cancelling..."
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Request</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancel}
                disabled={processing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {processing ? "Submitting..." : "Request Cancellation"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
