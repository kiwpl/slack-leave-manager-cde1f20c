import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import PolicyDisplay from "@/components/PolicyDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";

export default function SubmitRequestPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [requestType, setRequestType] = useState<"vacation" | "sick" | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sickDate, setSickDate] = useState("");
  const [note, setNote] = useState("");
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const today = format(new Date(), "yyyy-MM-dd");
  const hasSlackId = !!profile?.slack_user_id;

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!requestType) newErrors.requestType = "Please select a request type.";
    if (requestType === "vacation") {
      if (!startDate) newErrors.startDate = "Start date is required.";
      if (!endDate) newErrors.endDate = "End date is required.";
      if (startDate && endDate && startDate > endDate) {
        newErrors.endDate = "End date must be on or after start date.";
      }
    }
    if (requestType === "sick") {
      if (!sickDate) {
        newErrors.sickDate = "Sick date is required.";
      } else if (sickDate > today) {
        newErrors.sickDate = "Future sick days cannot be submitted. Please submit a vacation request or contact your manager.";
      }
    }
    if (!policyAcknowledged) {
      newErrors.policy = "You must acknowledge the policy before submitting.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;

    setSubmitting(true);
    const isSickDay = requestType === "sick";
    const status = isSickDay ? "approved" : "pending_approval";
    const approvalSource = isSickDay ? "system_auto_approved" : null;

    const { data, error } = await supabase.from("time_off_requests").insert({
      employee_id: user.id,
      request_type: requestType as "vacation" | "sick",
      start_date: requestType === "vacation" ? startDate : null,
      end_date: requestType === "vacation" ? endDate : null,
      sick_date: requestType === "sick" ? sickDate : null,
      note: note || null,
      status,
      approval_source: approvalSource,
      approved_at: isSickDay ? new Date().toISOString() : null,
    }).select().single();

    if (error) {
      toast.error("Failed to submit request: " + error.message);
      setSubmitting(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      request_id: data.id,
      action_type: isSickDay ? "sick_day_auto_approved" : "request_submitted",
      actor_type: "staff",
      actor_id: user.id,
      details: { request_type: requestType },
    });

    if (isSickDay) {
      supabase.functions.invoke("send-slack-notification", {
        body: { request_id: data.id, notification_type: "auto_approved_notification" },
      });
      supabase.functions.invoke("sync-google-calendar", {
        body: { request_id: data.id, action: "create" },
      });
    } else {
      supabase.functions.invoke("send-slack-notification", {
        body: { request_id: data.id, notification_type: "submission_confirmation" },
      });
      supabase.functions.invoke("send-slack-notification", {
        body: { request_id: data.id, notification_type: "approval_request" },
      });
    }

    toast.success(
      isSickDay
        ? "Sick day recorded and auto-approved."
        : "Vacation request submitted for approval."
    );
    navigate("/my-requests");
    setSubmitting(false);
  };

  if (!hasSlackId) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Submit Request</h1>
            <p className="text-muted-foreground">Request vacation or report a sick day</p>
          </div>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please add your Slack user ID before submitting a request.{" "}
              <Link to="/profile" className="underline font-medium">Go to Profile Settings</Link>
            </AlertDescription>
          </Alert>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Submit Request</h1>
          <p className="text-muted-foreground">Request vacation or report a sick day</p>
        </div>

        <PolicyDisplay />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Request Type</Label>
                <Select value={requestType} onValueChange={(v) => setRequestType(v as any)}>
                  <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation</SelectItem>
                    <SelectItem value="sick">Sick Day</SelectItem>
                  </SelectContent>
                </Select>
                {errors.requestType && <p className="text-sm text-destructive">{errors.requestType}</p>}
              </div>

              {requestType === "vacation" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Start Date</Label>
                    <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    {errors.startDate && <p className="text-sm text-destructive">{errors.startDate}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">End Date</Label>
                    <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    {errors.endDate && <p className="text-sm text-destructive">{errors.endDate}</p>}
                  </div>
                </div>
              )}

              {requestType === "sick" && (
                <div className="space-y-2">
                  <Label htmlFor="sickDate">Sick Date</Label>
                  <Input id="sickDate" type="date" value={sickDate} onChange={(e) => setSickDate(e.target.value)} max={today} />
                  {errors.sickDate && <p className="text-sm text-destructive">{errors.sickDate}</p>}
                </div>
              )}

              {requestType && (
                <div className="space-y-2">
                  <Label htmlFor="note">Note (optional)</Label>
                  <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any additional details..." rows={3} />
                </div>
              )}

              {requestType && (
                <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/50">
                  <Checkbox id="policyAck" checked={policyAcknowledged} onCheckedChange={(checked) => setPolicyAcknowledged(checked === true)} />
                  <Label htmlFor="policyAck" className="text-sm leading-snug cursor-pointer">
                    I have read and understand the vacation and sick day policy
                  </Label>
                </div>
              )}
              {errors.policy && <p className="text-sm text-destructive">{errors.policy}</p>}

              {requestType && (
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Request"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
