import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const [googleCalendarId, setGoogleCalendarId] = useState("");
  const [slackTestMode, setSlackTestMode] = useState(false);
  const [calendarTestMode, setCalendarTestMode] = useState(false);
  const [payPeriodAnchor, setPayPeriodAnchor] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("*")
      .then(({ data }) => {
        if (data) {
          data.forEach((s) => {
            if (s.key === "google_calendar_id") setGoogleCalendarId(s.value);
            if (s.key === "slack_test_mode") setSlackTestMode(s.value === "true");
            if (s.key === "calendar_test_mode") setCalendarTestMode(s.value === "true");
            if (s.key === "pay_period_anchor_date") setPayPeriodAnchor(s.value);
          });
        }
        setLoading(false);
      });
  }, []);

  const saveSetting = async (key: string, value: string) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success(`Setting "${key}" saved.`);
    }
  };

  return (
    <AppLayout>
      <div className="bg-yellow-50 -m-4 md:-m-8 p-4 md:p-8 min-h-full">
        <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
          <p className="text-muted-foreground">Configure integrations and app behavior</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {/* Google Calendar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Google Calendar</CardTitle>
                <CardDescription>Configure the shared Google Calendar for approved time off</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Shared Calendar ID</Label>
                  <div className="flex gap-2">
                    <Input
                      value={googleCalendarId}
                      onChange={(e) => setGoogleCalendarId(e.target.value)}
                      placeholder="example@group.calendar.google.com"
                    />
                    <Button onClick={() => saveSetting("google_calendar_id", googleCalendarId)}>
                      Save
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Test Mode</p>
                    <p className="text-xs text-muted-foreground">Log calendar actions without actually syncing</p>
                  </div>
                  <Switch
                    checked={calendarTestMode}
                    onCheckedChange={(checked) => {
                      setCalendarTestMode(checked);
                      saveSetting("calendar_test_mode", String(checked));
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Pay Period */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pay Period</CardTitle>
                <CardDescription>Configure bi-weekly pay period anchor for flexible time requests</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Anchor Date (start of any known pay period)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={payPeriodAnchor}
                      onChange={(e) => setPayPeriodAnchor(e.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                    <Button onClick={() => saveSetting("pay_period_anchor_date", payPeriodAnchor)}>
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Example: 2025-01-06. The system calculates all 2-week pay periods from this anchor date.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Slack */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Slack Integration</CardTitle>
                <CardDescription>Configure Slack notifications and approvals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Test Mode</p>
                    <p className="text-xs text-muted-foreground">Log Slack messages without sending</p>
                  </div>
                  <Switch
                    checked={slackTestMode}
                    onCheckedChange={(checked) => {
                      setSlackTestMode(checked);
                      saveSetting("slack_test_mode", String(checked));
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Slack bot token and signing secret are configured via environment secrets.
                  User Slack IDs are managed in User Management.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      </div>
    </AppLayout>
  );
}
