import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type Request = Tables<"time_off_requests">;

export default function EditRequestPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<Request | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sickDate, setSickDate] = useState("");
  const [note, setNote] = useState("");
  const [startHalfDay, setStartHalfDay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (!id) return;
    supabase
      .from("time_off_requests")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setRequest(data);
          setStartDate(data.start_date || "");
          setEndDate(data.end_date || "");
          setSickDate(data.sick_date || "");
          setNote(data.note || "");
        }
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!request || !user || request.employee_id !== user.id) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Request not found or access denied.</p>
        </div>
      </AppLayout>
    );
  }

  const isApprovedSickDay = request.request_type === "sick" && request.status === "approved";
  const isVacation = request.request_type === "vacation";
  const wasApproved = request.status === "approved";

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (isVacation) {
      if (!startDate) newErrors.startDate = "Start date is required.";
      if (!endDate) newErrors.endDate = "End date is required.";
      if (startDate && endDate && startDate > endDate) {
        newErrors.endDate = "End date must be on or after start date.";
      }
    }

    if (request.request_type === "sick" && !isApprovedSickDay) {
      if (sickDate > today) {
        newErrors.sickDate = "Future sick days cannot be submitted.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);

    const updates: any = {
      note: note || null,
      last_edited_at: new Date().toISOString(),
      last_edited_by_user_id: user.id,
    };

    if (isVacation) {
      updates.start_date = startDate;
      updates.end_date = endDate;
    }

    // If approved vacation is edited → back to pending
    if (isVacation && wasApproved) {
      updates.status = "pending_approval";
      updates.approved_at = null;
      updates.approved_by_user_id = null;
      updates.approval_source = null;
      updates.google_calendar_event_id = null;
    }

    // If rejected → resubmit as new cycle
    if (request.status === "rejected") {
      updates.status = "pending_approval";
      updates.rejected_at = null;
      updates.rejected_by_user_id = null;
      updates.rejection_reason = null;
      if (isVacation) {
        updates.start_date = startDate;
        updates.end_date = endDate;
      }
    }

    const { error } = await supabase
      .from("time_off_requests")
      .update(updates)
      .eq("id", id);

    if (error) {
      toast.error("Failed to update: " + error.message);
      setSubmitting(false);
      return;
    }

    const actionType = wasApproved
      ? "approved_request_edited"
      : request.status === "rejected"
      ? "rejected_request_resubmitted"
      : "request_edited";

    await supabase.from("audit_logs").insert({
      request_id: id,
      action_type: actionType,
      actor_type: "staff",
      actor_id: user.id,
      details: { changes: updates },
    });

    // Slack & calendar notifications
    if (wasApproved && isVacation) {
      // Remove calendar event since it's going back to pending
      supabase.functions.invoke("sync-google-calendar", {
        body: { request_id: id, action: "delete" },
      });
    }
    supabase.functions.invoke("send-slack-notification", {
      body: { request_id: id, notification_type: "edit_notification" },
    });
    if (request.status === "rejected" || (wasApproved && isVacation)) {
      // Re-send approval request to managers
      supabase.functions.invoke("send-slack-notification", {
        body: { request_id: id, notification_type: "approval_request" },
      });
    }

    toast.success(
      wasApproved
        ? "Request updated and sent back for approval."
        : "Request updated."
    );
    navigate(`/requests/${id}`);
    setSubmitting(false);
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Edit Request</h1>
            <p className="text-muted-foreground">
              {wasApproved && isVacation && "Changes will require re-approval."}
              {isApprovedSickDay && "You can only edit the note for approved sick days."}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {isVacation && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    {errors.startDate && <p className="text-sm text-destructive">{errors.startDate}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                    {errors.endDate && <p className="text-sm text-destructive">{errors.endDate}</p>}
                  </div>
                </div>
              )}

              {request.request_type === "sick" && !isApprovedSickDay && (
                <div className="space-y-2">
                  <Label>Sick Date</Label>
                  <Input
                    type="date"
                    value={sickDate}
                    onChange={(e) => setSickDate(e.target.value)}
                    max={today}
                  />
                  {errors.sickDate && <p className="text-sm text-destructive">{errors.sickDate}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Any additional details..."
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
