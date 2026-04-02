import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import RequestSummary, { countBusinessDays, calcTotal } from "@/components/RequestSummary";
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
import { AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { isWithin30Days } from "@/lib/specialApproval";

type Profile = Tables<"profiles">;

export default function ManagerSubmitRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [requestType, setRequestType] = useState<"vacation" | "sick" | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [startHalfDay, setStartHalfDay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .eq("status", "active")
      .order("full_name")
      .then(({ data }) => setProfiles(data || []));
  }, []);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!selectedEmployeeId) newErrors.employee = "Please select a staff member.";
    if (!requestType) newErrors.requestType = "Please select a request type.";
    if (!startDate) newErrors.startDate = "Start date is required.";
    if (requestType === "vacation") {
      if (!endDate) newErrors.endDate = "End date is required.";
      if (startDate && endDate && startDate > endDate) {
        newErrors.endDate = "End date must be on or after start date.";
      }
      if (!note.trim()) newErrors.note = "Please provide a reason for the vacation request.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;

    setSubmitting(true);
    const isSickDay = requestType === "sick";
    const startPortion = startHalfDay ? "pm" : "full";
    const effectiveEnd = endDate || startDate;

    const requiresSpecialApproval = !isSickDay && isWithin30Days(startDate);

    const { data, error } = await supabase.from("time_off_requests").insert({
      employee_id: selectedEmployeeId,
      request_type: requestType as "vacation" | "sick",
      start_date: startDate,
      end_date: effectiveEnd,
      sick_date: isSickDay ? startDate : null,
      note: note || null,
      status: "approved" as any,
      day_portion: "full" as any,
      start_day_portion: startPortion as any,
      end_day_portion: "full" as any,
      approval_source: "system_auto_approved" as any,
      approved_at: new Date().toISOString(),
      approved_by_user_id: user.id,
      requires_special_approval: requiresSpecialApproval,
    }).select().single();

    if (error) {
      toast.error("Failed to submit request: " + error.message);
      setSubmitting(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      request_id: data.id,
      action_type: "manager_submitted_approved",
      actor_type: "manager" as any,
      actor_id: user.id,
      details: { request_type: requestType, employee_id: selectedEmployeeId },
    });

    supabase.functions.invoke("send-slack-notification", {
      body: { request_id: data.id, notification_type: "approval_notification" },
    });
    supabase.functions.invoke("sync-google-calendar", {
      body: { request_id: data.id, action: "create" },
    });

    const selectedName = profiles.find((p) => p.id === selectedEmployeeId)?.full_name || "staff member";
    toast.success(`Request submitted and approved for ${selectedName}.`);
    navigate("/manager");
    setSubmitting(false);
  };

  const startDayPortion = startHalfDay ? "pm" : "full";

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Submit for Staff</h1>
          <p className="text-muted-foreground">Create a time-off request on behalf of a staff member (auto-approved)</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Staff Member</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select staff member..." /></SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.employee && <p className="text-sm text-destructive">{errors.employee}</p>}
              </div>

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

              {requestType && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
                        }}
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
                      />
                      {errors.endDate && <p className="text-sm text-destructive">{errors.endDate}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Checkbox id="startHalfDay" checked={startHalfDay} onCheckedChange={(c) => setStartHalfDay(c === true)} />
                    <Label htmlFor="startHalfDay" className="text-sm cursor-pointer">Half day on first day (afternoon off)</Label>
                  </div>

                  <RequestSummary
                    requestType={requestType}
                    startDate={startDate}
                    endDate={endDate}
                    startDayPortion={startDayPortion}
                  />

                  {requestType === "vacation" && startDate && endDate && (() => {
                    const biz = countBusinessDays(startDate, endDate);
                    const total = calcTotal(biz, startDayPortion, "full", startDate === endDate);
                    return total > 10 ? (
                      <Alert className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                          This request exceeds 10 business days.
                        </AlertDescription>
                      </Alert>
                    ) : null;
                  })()}

                  <div className="space-y-2">
                    <Label>{requestType === "vacation" ? "Reason" : "Note (optional)"}</Label>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={requestType === "vacation" ? "Please provide a reason..." : "Any additional details..."}
                      rows={3}
                    />
                    {errors.note && <p className="text-sm text-destructive">{errors.note}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit & Auto-Approve"}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
