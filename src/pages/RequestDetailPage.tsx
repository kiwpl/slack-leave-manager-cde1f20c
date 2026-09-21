import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Bell, Calendar, CheckCircle2, Edit, Trash2, XCircle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import SpecialApprovalBadge from "@/components/SpecialApprovalBadge";

type Request = Tables<"time_off_requests">;
type AuditLog = Tables<"audit_logs">;

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isManager } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<Request | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    const [{ data: req }, { data: logs }] = await Promise.all([
      supabase.from("time_off_requests").select("*").eq("id", id).single(),
      supabase.from("audit_logs").select("*").eq("request_id", id).order("created_at", { ascending: true }),
    ]);
    setRequest(req);
    setAuditLogs(logs || []);

    if (req?.employee_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", req.employee_id)
        .maybeSingle();
      setEmployeeName(profile?.full_name || "");
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const canEdit = request && user && request.employee_id === user.id && (
    request.status === "pending_approval" ||
    request.status === "approved" ||
    request.status === "rejected"
  );

  const canCancel = request && user && request.employee_id === user.id && (
    request.status === "pending_approval" || request.status === "approved"
  );

  const isCancelRequested = (request?.status as string) === "cancel_requested" && request?.employee_id === user?.id;

  const canRemind = request && user && request.employee_id === user.id && request.status === "pending_approval";

  // Same rule Slack uses: any manager or admin can decide any pending request.
  const canDecide = !!request && !!user && isManager && request.status === "pending_approval";

  const handleApprove = async () => {
    if (!request || !user || !id) return;
    setProcessing(true);

    // Only a request that is STILL pending may be approved. Without this the
    // two managers who both press Approve at the same moment would each create
    // a calendar event, and the second would overwrite the stored event id,
    // leaving the first orphaned on the shared calendar forever.
    const { data: approved, error } = await supabase
      .from("time_off_requests")
      .update({
        status: "approved",
        approval_source: "manager",
        approved_at: new Date().toISOString(),
        approved_by_user_id: user.id,
      })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id");

    if (error) {
      toast.error("Could not approve this request: " + error.message);
      setProcessing(false);
      return;
    }
    if (!approved || approved.length === 0) {
      toast.info("This request was already decided by someone else. Refreshing.");
      fetchData();
      setProcessing(false);
      return;
    }

    const { error: logError } = await supabase.from("audit_logs").insert({
      request_id: id,
      action_type: "approved",
      actor_type: "manager" as const,
      actor_id: user.id,
      details: { via: "app" },
    });
    if (logError) {
      console.error("[approve] Audit log insert failed:", logError);
      toast.warning("Approved, but the action could not be written to the audit log.");
    }

    // Calendar events are only created once a request is actually approved.
    supabase.functions.invoke("sync-google-calendar", {
      body: { request_id: id, action: "create" },
    });

    // Tells the employee, and closes out the Approve/Reject buttons still
    // sitting in every manager's Slack DM for this request.
    supabase.functions.invoke("send-slack-notification", {
      body: { request_id: id, notification_type: "approval_notification" },
    });

    toast.success("Request approved. The employee has been notified in Slack.");
    fetchData();
    setProcessing(false);
  };

  const handleReject = async () => {
    if (!request || !user || !id) return;
    setProcessing(true);

    const reason = rejectionReason.trim() || "Rejected by manager";

    const { data: rejected, error } = await supabase
      .from("time_off_requests")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by_user_id: user.id,
        rejection_reason: reason,
      })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id");

    if (error) {
      toast.error("Could not reject this request: " + error.message);
      setProcessing(false);
      return;
    }
    if (!rejected || rejected.length === 0) {
      toast.info("This request was already decided by someone else. Refreshing.");
      setRejectDialogOpen(false);
      fetchData();
      setProcessing(false);
      return;
    }

    const { error: logError } = await supabase.from("audit_logs").insert({
      request_id: id,
      action_type: "rejected",
      actor_type: "manager" as const,
      actor_id: user.id,
      details: { via: "app", rejection_reason: reason },
    });
    if (logError) {
      console.error("[reject] Audit log insert failed:", logError);
      toast.warning("Rejected, but the action could not be written to the audit log.");
    }

    supabase.functions.invoke("send-slack-notification", {
      body: {
        request_id: id,
        notification_type: "rejection_notification",
        extra: { rejection_reason: reason },
      },
    });

    toast.success("Request rejected. The employee has been notified in Slack.");
    setRejectDialogOpen(false);
    setRejectionReason("");
    fetchData();
    setProcessing(false);
  };

  const handleReminder = async () => {
    if (!request || !user || !id) return;
    setSendingReminder(true);
    try {
      const { error } = await supabase.functions.invoke("send-slack-notification", {
        body: { request_id: id, notification_type: "approval_reminder" },
      });
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        request_id: id,
        action_type: "reminder_sent",
        actor_type: "staff" as const,
        actor_id: user.id,
        details: {},
      });
      toast.success("Reminder sent to managers.");
      fetchData();
    } catch {
      toast.error("Failed to send reminder.");
    }
    setSendingReminder(false);
  };


  const handleCancel = async () => {
    if (!request || !user || !id) return;
    setCancelling(true);

    const { error } = await (supabase
      .from("time_off_requests") as any)
      .update({
        status: "cancel_requested",
        previous_status: request.status,
        cancelled_by_user_id: user.id,
        cancellation_reason: cancellationReason || null,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to submit cancellation request: " + error.message);
      setCancelling(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      request_id: id,
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
            request_id: id,
            notification_type: "cancel_request_notification",
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

    setCancelDialogOpen(false);
    fetchData();
    setCancelling(false);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!request) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Request not found.</p>
          <Button variant="ghost" asChild className="mt-4">
            <Link to="/my-requests">← Back to My Requests</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground capitalize">
              {request.request_type === "vacation" ? "Vacation Request" : "Sick Day Request"}
            </h1>
            {employeeName && request.employee_id !== user?.id && (
              <p className="text-sm text-muted-foreground">{employeeName}</p>
            )}
          </div>
          <StatusBadge status={request.status} approvalSource={request.approval_source} />
          {(request as any).requires_special_approval && <SpecialApprovalBadge />}
        </div>

        {/* Request details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Request Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Type</p>
                <p className="font-medium capitalize text-foreground">{request.request_type}</p>
              </div>
              {request.request_type === "vacation" ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Dates</p>
                    <p className="font-medium text-foreground">
                      {request.start_date}{request.start_day_portion === "pm" ? " (afternoon)" : ""} → {request.end_date}
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Sick Date</p>
                  <p className="font-medium text-foreground">
                    {request.sick_date || request.start_date}{request.start_day_portion === "pm" ? " (afternoon)" : ""}
                    {request.end_date && request.end_date !== (request.sick_date || request.start_date) ? ` → ${request.end_date}` : ""}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Submitted</p>
                <p className="font-medium text-foreground">{new Date(request.submitted_at).toLocaleString()}</p>
              </div>
              {request.note && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Note</p>
                  <p className="text-foreground">{request.note}</p>
                </div>
              )}
              {request.rejection_reason && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Rejection Reason</p>
                  <p className="text-destructive">{request.rejection_reason}</p>
                </div>
              )}
              {request.cancellation_reason && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Cancellation Reason</p>
                  <p className="text-muted-foreground">{request.cancellation_reason}</p>
                </div>
              )}
              {request.google_calendar_event_id && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Calendar Sync</p>
                  <p className="text-sm text-success">✓ Synced to Google Calendar</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Manager decision */}
        {canDecide && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Approving adds this to the shared calendar and notifies{" "}
                {employeeName || "the employee"} in Slack. You can also use the
                buttons in your Slack message — either place does the same thing.
              </p>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleApprove} disabled={processing}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {processing ? "Working..." : "Approve"}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setRejectDialogOpen(true)}
                  disabled={processing}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reject dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Request</DialogTitle>
              <DialogDescription>
                {employeeName || "The employee"} will be told in Slack that this
                request was rejected, along with any reason you give here.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Let them know why..."
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRejectDialogOpen(false)}>
                Keep Pending
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={processing}>
                {processing ? "Working..." : "Reject Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Actions */}
        {(canEdit || canCancel || canRemind || isCancelRequested) && (
          <div className="flex gap-3 flex-wrap">
            {canRemind && (
              <Button variant="outline" onClick={handleReminder} disabled={sendingReminder}>
                <Bell className="h-4 w-4 mr-2" />
                {sendingReminder ? "Sending..." : "Remind Manager"}
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" asChild>
                <Link to={`/requests/${request.id}/edit`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Request
                </Link>
              </Button>
            )}
            {isCancelRequested && (
              <Button variant="outline" disabled className="opacity-60 cursor-not-allowed">
                <Trash2 className="h-4 w-4 mr-2" />
                Cancellation Requested
              </Button>
            )}
            {canCancel && (
              <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Cancel Request
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Request Cancellation</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to request cancellation of this {request.request_type} request?
                      Your manager will be notified and must approve or deny the cancellation.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label>Reason for cancellation (optional)</Label>
                    <Textarea
                      value={cancellationReason}
                      onChange={(e) => setCancellationReason(e.target.value)}
                      placeholder="Let your manager know why you're cancelling..."
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setCancelDialogOpen(false)}>
                      Keep Request
                    </Button>
                    <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
                      {cancelling ? "Submitting..." : "Request Cancellation"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <div className="space-y-4">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex gap-3">
                    <div className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {formatActionType(log.action_type)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()} · by {log.actor_type}
                      </p>
                      {log.details && typeof log.details === "object" && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {JSON.stringify(log.details)}
                        </p>
                      )}
                    </div>
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

function formatActionType(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
