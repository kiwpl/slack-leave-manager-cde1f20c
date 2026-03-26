import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import PolicyDisplay from "@/components/PolicyDisplay";
import StatusBadge from "@/components/StatusBadge";
import RequestSummary from "@/components/RequestSummary";
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
import { AlertCircle, Plus, ChevronDown, ChevronUp } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Request = Tables<"time_off_requests">;

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Form state
  const [requestType, setRequestType] = useState<"vacation" | "sick" | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [startHalfDay, setStartHalfDay] = useState(false);
  const [startHalfDayPortion, setStartHalfDayPortion] = useState<"am" | "pm">("am");
  const [endHalfDay, setEndHalfDay] = useState(false);
  const [endHalfDayPortion, setEndHalfDayPortion] = useState<"am" | "pm">("am");
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const today = format(new Date(), "yyyy-MM-dd");
  const hasSlackId = !!profile?.slack_user_id;

  const fetchRequests = () => {
    if (!user) return;
    supabase
      .from("time_off_requests")
      .select("*")
      .eq("employee_id", user.id)
      .order("submitted_at", { ascending: false })
      .then(({ data }) => {
        setRequests(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { fetchRequests(); }, [user]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!requestType) newErrors.requestType = "Please select a request type.";
    if (!startDate) newErrors.startDate = "Start date is required.";

    if (requestType === "vacation") {
      if (!endDate) newErrors.endDate = "End date is required.";
      if (startDate && endDate && startDate > endDate) {
        newErrors.endDate = "End date must be on or after start date.";
      }
    }

    if (requestType === "sick") {
      if (startDate && startDate > today) {
        newErrors.startDate = "Future sick days cannot be submitted. Please submit a vacation request or contact your manager.";
      }
      const effectiveEnd = endDate || startDate;
      if (effectiveEnd && effectiveEnd > today) {
        newErrors.endDate = "Sick day end date cannot be in the future.";
      }
    }

    if (!policyAcknowledged) {
      newErrors.policy = "You must acknowledge the policy before submitting.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const resetForm = () => {
    setRequestType("");
    setStartDate("");
    setEndDate("");
    setNote("");
    setStartHalfDay(false);
    setStartHalfDayPortion("am");
    setEndHalfDay(false);
    setEndHalfDayPortion("am");
    setPolicyAcknowledged(false);
    setErrors({});
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;

    setSubmitting(true);
    const isSickDay = requestType === "sick";
    const status = isSickDay ? "approved" : "pending_approval";
    const approvalSource = isSickDay ? "system_auto_approved" : null;
    const startPortion = startHalfDay ? startHalfDayPortion : "full";
    const endPortion = endHalfDay ? endHalfDayPortion : "full";
    const effectiveEnd = endDate || startDate;

    const { data, error } = await supabase.from("time_off_requests").insert({
      employee_id: user.id,
      request_type: requestType as "vacation" | "sick",
      start_date: startDate,
      end_date: effectiveEnd,
      sick_date: isSickDay ? startDate : null,
      note: note || null,
      status,
      day_portion: endPortion as any,
      start_day_portion: startPortion as any,
      end_day_portion: endPortion as any,
      approval_source: approvalSource,
      approved_at: isSickDay ? new Date().toISOString() : null,
    }).select().single();

    if (error) {
      toast.error("Failed to submit: " + error.message);
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

    toast.success(isSickDay ? "Sick day recorded and auto-approved." : "Vacation request submitted for approval.");
    resetForm();
    fetchRequests();
    setSubmitting(false);
  };

  const startDayPortion = startHalfDay ? startHalfDayPortion : "full";
  const endDayPortion = endHalfDay ? endHalfDayPortion : "full";
  const displayedRequests = showAll ? requests : requests.slice(0, 5);

  const formatRequestDates = (req: Request) => {
    const startP = (req as any).start_day_portion || "full";
    const endP = (req as any).end_day_portion || req.day_portion || "full";
    const startSuffix = startP === "am" ? " (morning)" : startP === "pm" ? " (afternoon)" : "";
    const endSuffix = endP === "am" ? " (morning)" : endP === "pm" ? " (afternoon)" : "";

    if (req.request_type === "vacation") {
      if (req.start_date === req.end_date || !req.end_date) {
        if (startP === "am" || endP === "am") return `Morning off · ${req.start_date}`;
        if (startP === "pm" || endP === "pm") return `Afternoon off · ${req.start_date}`;
        return req.start_date;
      }
      return `${req.start_date}${startSuffix} → ${req.end_date}${endSuffix}`;
    }
    if (req.start_date && req.end_date && req.start_date !== req.end_date) {
      return `${req.start_date}${startSuffix} → ${req.end_date}${endSuffix}`;
    }
    if (startP === "am" || endP === "am") return `Morning · ${req.sick_date || req.start_date}`;
    if (startP === "pm" || endP === "pm") return `Afternoon · ${req.sick_date || req.start_date}`;
    return req.sick_date || req.start_date;
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Slack ID warning — only when profile is loaded */}
        {profile && !hasSlackId && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your Slack ID is not set up. Please contact your <strong>Office Manager</strong> to get this configured before submitting requests.
            </AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Time Off</h1>
          {hasSlackId && (
            <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "outline" : "default"} size="sm">
              {showForm ? <>Cancel</> : <><Plus className="h-4 w-4 mr-1" /> New Request</>}
            </Button>
          )}
        </div>

        {/* Submit form */}
        {showForm && (
          <>
            <PolicyDisplay />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New Request</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Type */}
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={requestType} onValueChange={(v) => setRequestType(v as any)}>
                      <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vacation">Vacation</SelectItem>
                        <SelectItem value="sick">Sick Day</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.requestType && <p className="text-sm text-destructive">{errors.requestType}</p>}
                  </div>

                  {requestType && (
                    <>
                      {/* Dates */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Start Date</Label>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => {
                              setStartDate(e.target.value);
                              if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
                            }}
                            max={requestType === "sick" ? today : undefined}
                          />
                          {errors.startDate && <p className="text-sm text-destructive">{errors.startDate}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label>End Date</Label>
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            min={startDate || undefined}
                            max={requestType === "sick" ? today : undefined}
                          />
                          {errors.endDate && <p className="text-sm text-destructive">{errors.endDate}</p>}
                        </div>
                      </div>

                      {/* Half day toggles */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Checkbox id="startHalfDay" checked={startHalfDay} onCheckedChange={(c) => setStartHalfDay(c === true)} />
                          <Label htmlFor="startHalfDay" className="text-sm cursor-pointer">Half day on first day</Label>
                        </div>
                        {startHalfDay && (
                          <Select value={startHalfDayPortion} onValueChange={(v) => setStartHalfDayPortion(v as "am" | "pm")}>
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="am">Morning only</SelectItem>
                              <SelectItem value="pm">Afternoon only</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Checkbox id="endHalfDay" checked={endHalfDay} onCheckedChange={(c) => setEndHalfDay(c === true)} />
                          <Label htmlFor="endHalfDay" className="text-sm cursor-pointer">Half day on last day</Label>
                        </div>
                        {endHalfDay && (
                          <Select value={endHalfDayPortion} onValueChange={(v) => setEndHalfDayPortion(v as "am" | "pm")}>
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="am">Morning only</SelectItem>
                              <SelectItem value="pm">Afternoon only</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {/* Summary */}
                      <RequestSummary
                        requestType={requestType}
                        startDate={startDate}
                        endDate={endDate}
                        startDayPortion={startDayPortion}
                        endDayPortion={endDayPortion}
                      />

                      {/* Note */}
                      <div className="space-y-2">
                        <Label>Note (optional)</Label>
                        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any details..." rows={2} />
                      </div>

                      {/* Policy ack */}
                      <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/50">
                        <Checkbox id="policyAck" checked={policyAcknowledged} onCheckedChange={(c) => setPolicyAcknowledged(c === true)} />
                        <Label htmlFor="policyAck" className="text-sm leading-snug cursor-pointer">
                          I have read and understand the policy
                        </Label>
                      </div>
                      {errors.policy && <p className="text-sm text-destructive">{errors.policy}</p>}

                      <Button type="submit" className="w-full" disabled={submitting}>
                        {submitting ? "Submitting..." : "Submit"}
                      </Button>
                    </>
                  )}
                </form>
              </CardContent>
            </Card>
          </>
        )}

        {/* Request list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <div className="space-y-2">
                {displayedRequests.map((req) => (
                  <Link
                    key={req.id}
                    to={`/requests/${req.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm text-foreground capitalize">
                          {req.request_type === "vacation" ? "Vacation" : "Sick Day"}
                        </span>
                        <StatusBadge status={req.status} approvalSource={req.approval_source} />
                      </div>
                      <p className="text-xs text-muted-foreground">{formatRequestDates(req)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.submitted_at).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
                {requests.length > 5 && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(!showAll)}>
                    {showAll ? <><ChevronUp className="h-4 w-4 mr-1" /> Show less</> : <><ChevronDown className="h-4 w-4 mr-1" /> Show all {requests.length} requests</>}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
