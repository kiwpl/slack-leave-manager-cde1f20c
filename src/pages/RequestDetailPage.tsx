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
import { ArrowLeft, Bell, Calendar, Edit, Trash2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Request = Tables<"time_off_requests">;
type AuditLog = Tables<"audit_logs">;

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<Request | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    const [{ data: req }, { data: logs }] = await Promise.all([
      supabase.from("time_off_requests").select("*").eq("id", id).single(),
      supabase.from("audit_logs").select("*").eq("request_id", id).order("created_at", { ascending: true }),
    ]);
    setRequest(req);
    setAuditLogs(logs || []);
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

  const canRemind = request && user && request.employee_id === user.id && request.status === "pending_approval";

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

  const canCancel = request && user && request.employee_id === user.id && (
    request.status === "pending_approval" || request.status === "approved"
  );

  const needsCancelReason = request?.status === "approved" && request?.request_type === "vacation";

  const handleCancel = async () => {
    if (!request || !user || !id) return;
    if (needsCancelReason && !cancellationReason.trim()) {
      toast.error("Please provide a cancellation reason.");
      return;
    }

    setCancelling(true);

    const { error } = await supabase
      .from("time_off_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by_user_id: user.id,
        cancellation_reason: cancellationReason || null,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to cancel: " + error.message);
      setCancelling(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      request_id: id,
      action_type: "request_cancelled",
      actor_type: "staff",
      actor_id: user.id,
      details: { reason: cancellationReason || "No reason provided" },
    });

    // Delete calendar event if it was approved
    if (request.status === "approved" && request.google_calendar_event_id) {
      supabase.functions.invoke("sync-google-calendar", {
        body: { request_id: id, action: "delete" },
      });
    }

    // Notify via Slack
    supabase.functions.invoke("send-slack-notification", {
      body: { request_id: id, notification_type: "cancellation_notification" },
    });

    toast.success("Request cancelled.");
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
          </div>
          <StatusBadge status={request.status} approvalSource={request.approval_source} />
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
                    <p className="font-medium text-foreground">{request.start_date} → {request.end_date}</p>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Sick Date</p>
                  <p className="font-medium text-foreground">{request.sick_date}</p>
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

        {/* Actions */}
        {(canEdit || canCancel || canRemind) && (
          <div className="flex gap-3">
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
                    <DialogTitle>Cancel Request</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to cancel this {request.request_type} request?
                      {request.status === "approved" && " This will remove it from the shared calendar."}
                    </DialogDescription>
                  </DialogHeader>
                  {needsCancelReason && (
                    <div className="space-y-2">
                      <Label>Cancellation Reason (required)</Label>
                      <Textarea
                        value={cancellationReason}
                        onChange={(e) => setCancellationReason(e.target.value)}
                        placeholder="Please explain why you're cancelling..."
                      />
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setCancelDialogOpen(false)}>
                      Keep Request
                    </Button>
                    <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
                      {cancelling ? "Cancelling..." : "Confirm Cancellation"}
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
