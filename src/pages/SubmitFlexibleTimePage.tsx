import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertCircle, Info, Plus, Trash2, Clock } from "lucide-react";
import { getPayPeriod, parseDateUTC, parseLocalDate, formatDateUTC, getWeekKey } from "@/lib/payPeriod";
import TimeSelect from "@/components/TimeSelect";

interface MakeupEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

function calcHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
  return Math.max(0, Math.round(diff * 100) / 100);
}

export default function SubmitFlexibleTimePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [dateOff, setDateOff] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [makeupEntries, setMakeupEntries] = useState<MakeupEntry[]>([
    { id: crypto.randomUUID(), date: "", startTime: "", endTime: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [usedThisMonth, setUsedThisMonth] = useState(false);
  const [loadingEligibility, setLoadingEligibility] = useState(true);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  const today = format(new Date(), "yyyy-MM-dd");
  const totalHoursOff = calcHours(startTime, endTime);
  const totalMakeupHours = makeupEntries.reduce(
    (sum, e) => sum + calcHours(e.startTime, e.endTime),
    0
  );

  // Load eligibility + anchor
  useEffect(() => {
    if (!user) return;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = format(nextMonth, "yyyy-MM-dd");

    Promise.all([
      supabase
        .from("flexible_time_requests")
        .select("id")
        .eq("employee_id", user.id)
        .gte("submitted_at", monthStart)
        .lt("submitted_at", monthEnd)
        .not("status", "in", "(cancelled,rejected)"),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "pay_period_anchor_date")
        .single(),
    ]).then(([reqRes, anchorRes]) => {
      setUsedThisMonth((reqRes.data?.length || 0) > 0);
      setAnchorDate(anchorRes.data?.value || null);
      setLoadingEligibility(false);
    });
  }, [user]);

  const addMakeupEntry = () => {
    setMakeupEntries([
      ...makeupEntries,
      { id: crypto.randomUUID(), date: "", startTime: "", endTime: "" },
    ]);
  };

  const removeMakeupEntry = (id: string) => {
    if (makeupEntries.length <= 1) return;
    setMakeupEntries(makeupEntries.filter((e) => e.id !== id));
  };

  const updateMakeupEntry = (id: string, field: keyof MakeupEntry, value: string) => {
    setMakeupEntries(
      makeupEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!dateOff) newErrors.dateOff = "Date is required.";
    else if (dateOff <= today)
      newErrors.dateOff = "Date must be in the future. No retroactive requests allowed.";

    if (!startTime) newErrors.startTime = "Start time is required.";
    if (!endTime) newErrors.endTime = "End time is required.";
    if (startTime && endTime && totalHoursOff <= 0) newErrors.endTime = "End time must be after start time.";
    if (totalHoursOff > 4) newErrors.endTime = "Maximum 4 hours per request.";

    if (usedThisMonth) {
      newErrors.eligibility = "You have already used your flexible time request this month.";
    }

    if (!anchorDate) {
      newErrors.anchor = "Pay period anchor date is not configured. Contact your admin.";
    }

    // Validate makeup entries
    const entryErrors: string[] = [];
    let payPeriod: { start: Date; end: Date } | null = null;
    if (dateOff && anchorDate) {
      payPeriod = getPayPeriod(parseDateUTC(dateOff), parseDateUTC(anchorDate));
    }

    const weekHoursMap: Record<string, number> = {};

    makeupEntries.forEach((entry, i) => {
      if (!entry.date) entryErrors.push(`Make-up entry ${i + 1}: date is required.`);
      if (!entry.startTime) entryErrors.push(`Make-up entry ${i + 1}: start time is required.`);
      if (!entry.endTime) entryErrors.push(`Make-up entry ${i + 1}: end time is required.`);

      const entryHours = calcHours(entry.startTime, entry.endTime);
      if (entryHours <= 0 && entry.startTime && entry.endTime) {
        entryErrors.push(`Make-up entry ${i + 1}: end time must be after start time.`);
      }
      if (entryHours > 0 && entryHours < 0.5) {
        entryErrors.push(`Make-up entry ${i + 1}: minimum duration is 30 minutes.`);
      }

      if (entry.date && payPeriod) {
        const entryDate = parseDateUTC(entry.date);
        if (entryDate < payPeriod.start || entryDate > payPeriod.end) {
          entryErrors.push(
            `Make-up entry ${i + 1}: must fall within the same pay period (${formatDateUTC(payPeriod.start)} to ${formatDateUTC(payPeriod.end)}).`
          );
        }
      }

      if (entry.date && entryHours > 0) {
        const wk = getWeekKey(parseDateUTC(entry.date));
        weekHoursMap[wk] = (weekHoursMap[wk] || 0) + entryHours;
      }
    });

    // Check 4-hour weekly cap
    for (const [wk, hrs] of Object.entries(weekHoursMap)) {
      if (hrs > 4) {
        entryErrors.push(
          `Make-up hours in week ${wk} total ${hrs}h, exceeding the 4-hour weekly cap.`
        );
      }
    }

    // Total makeup must be 0.5-4 hours in 30-min increments AND exactly equal time off
    if (totalMakeupHours > 0) {
      if (totalMakeupHours > 4) {
        entryErrors.push(
          `Total make-up hours (${totalMakeupHours}h) cannot exceed 4 hours.`
        );
      } else if (Math.abs((totalMakeupHours * 2) - Math.round(totalMakeupHours * 2)) > 0.01) {
        entryErrors.push(
          `Total make-up hours (${totalMakeupHours}h) must be in 30-minute increments.`
        );
      }
    }

    if (totalHoursOff > 0 && Math.abs(totalMakeupHours - totalHoursOff) > 0.01) {
      if (totalMakeupHours < totalHoursOff) {
        entryErrors.push(
          `Your make-up time (${totalMakeupHours}h) must equal your time off (${totalHoursOff}h). Please adjust your make-up entries.`
        );
      } else {
        entryErrors.push(
          `Your make-up time (${totalMakeupHours}h) exceeds your time off (${totalHoursOff}h). Please reduce your make-up entries.`
        );
      }
    }

    if (entryErrors.length > 0) {
      newErrors.entries = entryErrors.join("\n");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user || !anchorDate) return;

    setSubmitting(true);
    const payPeriod = getPayPeriod(parseDateUTC(dateOff), parseDateUTC(anchorDate));

    // Build a makeup plan summary from entries
    const makeupPlanSummary = makeupEntries
      .map((e, i) => `Entry ${i + 1}: ${e.date} ${e.startTime}-${e.endTime} (${calcHours(e.startTime, e.endTime)}h)`)
      .join("; ");

    const { data, error } = await supabase
      .from("flexible_time_requests")
      .insert({
        employee_id: user.id,
        date_off: dateOff,
        start_time: startTime,
        end_time: endTime,
        total_hours: totalHoursOff,
        makeup_plan: makeupPlanSummary,
        status: "pending_approval",
        pay_period_start: formatDateUTC(payPeriod.start),
        pay_period_end: formatDateUTC(payPeriod.end),
      })
      .select()
      .single();

    if (error || !data) {
      toast.error("Failed to submit: " + (error?.message || "Unknown error"));
      setSubmitting(false);
      return;
    }

    // Insert makeup entries
    const entries = makeupEntries.map((e) => ({
      request_id: data.id,
      makeup_date: e.date,
      start_time: e.startTime,
      end_time: e.endTime,
      hours: calcHours(e.startTime, e.endTime),
    }));

    const { error: entryError } = await supabase
      .from("flexible_time_makeup_entries")
      .insert(entries);

    if (entryError) {
      toast.error("Failed to save make-up entries: " + entryError.message);
      setSubmitting(false);
      return;
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      request_id: data.id,
      action_type: "flexible_time_submitted",
      actor_type: "staff",
      actor_id: user.id,
      details: { total_hours: totalHoursOff, makeup_entries: entries.length },
    });

    // Slack notification
    supabase.functions.invoke("send-slack-notification", {
      body: {
        request_id: data.id,
        notification_type: "flexible_time_request",
        flexible_time: true,
      },
    });

    toast.success("Flexible time request submitted for approval.");
    navigate(`/flexible-time/${data.id}`);
    setSubmitting(false);
  };

  const completedSessions = makeupEntries.filter(e => e.date && e.startTime && e.endTime).length;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Submit Flexible Time Request
          </h1>
          <p className="text-muted-foreground">
            Request up to 4 hours off with a make-up plan.
            <span className="block text-xs mt-1">Available for office and admin staff only.</span>
          </p>
        </div>

        {/* Eligibility */}
        {!loadingEligibility && (
          <Alert
            variant={usedThisMonth ? "destructive" : "default"}
            className={
              usedThisMonth
                ? undefined
                : "border-primary/30 bg-primary/5"
            }
          >
            <Clock className="h-4 w-4" />
            <AlertDescription>
              {usedThisMonth
                ? "You have already used your 1 flexible time request this month."
                : "You have 1 flexible time request available this month."}
            </AlertDescription>
          </Alert>
        )}

        {!anchorDate && !loadingEligibility && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Pay period anchor date is not configured. Contact your admin to set
              this up in Admin Settings before submitting.
            </AlertDescription>
          </Alert>
        )}

        {errors.eligibility && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errors.eligibility}</AlertDescription>
          </Alert>
        )}

        {!usedThisMonth && anchorDate && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Time Off Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Date off */}
                <div className="space-y-2">
                  <Label>Date of Time Off</Label>
                  <Input
                    type="date"
                    value={dateOff}
                    onChange={(e) => setDateOff(e.target.value)}
                    min={format(
                      new Date(Date.now() + 86400000),
                      "yyyy-MM-dd"
                    )}
                  />
                  {errors.dateOff && (
                    <p className="text-sm text-destructive">{errors.dateOff}</p>
                  )}
                </div>

                {/* Time range - 30min interval selects */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <TimeSelect
                      value={startTime}
                      onChange={setStartTime}
                      placeholder="Start time"
                    />
                    {errors.startTime && (
                      <p className="text-sm text-destructive">
                        {errors.startTime}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <TimeSelect
                      value={endTime}
                      onChange={setEndTime}
                      placeholder="End time"
                    />
                    {errors.endTime && (
                      <p className="text-sm text-destructive">
                        {errors.endTime}
                      </p>
                    )}
                  </div>
                </div>

                {/* Natural language recap */}
                {dateOff && startTime && endTime && totalHoursOff > 0 && (
                  <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm space-y-1">
                    <p>
                      You are requesting{" "}
                      <span className="font-semibold">{totalHoursOff} hour{totalHoursOff !== 1 ? "s" : ""}</span>{" "}
                      off on{" "}
                      <span className="font-semibold">
                        {format(parseLocalDate(dateOff), "EEEE, MMMM d, yyyy")}
                      </span>
                      , from{" "}
                      <span className="font-semibold">{startTime}</span> to{" "}
                      <span className="font-semibold">{endTime}</span>.
                    </p>
                    {totalHoursOff > 0 && (
                      <p>
                        You must make up exactly{" "}
                        <span className="font-semibold">{totalHoursOff} hour{totalHoursOff !== 1 ? "s" : ""}</span>{" "}
                        across your entries. Current make-up total:{" "}
                        <span className={`font-semibold ${Math.abs(totalMakeupHours - totalHoursOff) > 0.01 ? "text-destructive" : "text-primary"}`}>
                          {totalMakeupHours}h
                        </span>
                        {" "}({completedSessions} session{completedSessions !== 1 ? "s" : ""}).
                      </p>
                    )}
                    {totalHoursOff > 4 && (
                      <p className="text-destructive font-medium">
                        ⚠ This exceeds the 4-hour maximum.
                      </p>
                    )}
                  </div>
                )}

                {/* Make-up entries */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Make-Up Time Entries</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addMakeupEntry}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add Entry
                    </Button>
                  </div>

                  <Alert className="border-primary/30 bg-primary/5">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      All make-up time must be completed within the same pay period as your time off. Times must be in 30-minute intervals.
                    </AlertDescription>
                  </Alert>

                  {dateOff && anchorDate && (() => {
                    const pp = getPayPeriod(parseDateUTC(dateOff), parseDateUTC(anchorDate));
                    return (
                      <p className="text-xs text-muted-foreground">
                        Pay period: {formatDateUTC(pp.start)} to {formatDateUTC(pp.end)}.
                        Make-up dates must fall within this period.
                      </p>
                    );
                  })()}

                  {makeupEntries.map((entry, i) => (
                    <div
                      key={entry.id}
                      className="p-3 rounded-lg border border-border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          Entry {i + 1}
                        </span>
                        {makeupEntries.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeMakeupEntry(entry.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Date</Label>
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) =>
                              updateMakeupEntry(entry.id, "date", e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Start</Label>
                          <TimeSelect
                            value={entry.startTime}
                            onChange={(v) => updateMakeupEntry(entry.id, "startTime", v)}
                            placeholder="Start"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">End</Label>
                          <TimeSelect
                            value={entry.endTime}
                            onChange={(v) => updateMakeupEntry(entry.id, "endTime", v)}
                            placeholder="End"
                          />
                        </div>
                      </div>
                      {calcHours(entry.startTime, entry.endTime) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {calcHours(entry.startTime, entry.endTime)}h
                        </p>
                      )}
                    </div>
                  ))}

                  {/* Total makeup hours */}
                  {totalMakeupHours > 0 && (
                    <div className="p-3 rounded-lg border border-border bg-muted/50 text-sm">
                      <span className="font-medium">
                        Total make-up hours:
                      </span>{" "}
                      {totalMakeupHours}h
                      <span className="text-muted-foreground ml-2">
                        (must be 1–4h in 30-min increments)
                      </span>
                    </div>
                  )}
                </div>

                {errors.entries && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="whitespace-pre-line">
                      {errors.entries}
                    </AlertDescription>
                  </Alert>
                )}

                {errors.anchor && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{errors.anchor}</AlertDescription>
                  </Alert>
                )}

                <Alert className="border-muted-foreground/20 bg-muted/50">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs text-muted-foreground">
                    This request will not take effect until it has been reviewed and approved by a manager.
                  </AlertDescription>
                </Alert>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || usedThisMonth}
                >
                  {submitting ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
