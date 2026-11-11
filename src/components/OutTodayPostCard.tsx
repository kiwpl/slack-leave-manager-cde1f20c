import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/**
 * Admin Settings card for the weekday "Out today" message. The message is sent
 * by the post-out-today edge function to managers and admins in their Time Off
 * Manager app chat, and only on days when someone is off.
 */

const TIMES: [string, string][] = [
  ["07:00", "7:00 AM"],
  ["07:30", "7:30 AM"],
  ["08:00", "8:00 AM"],
  ["08:30", "8:30 AM"],
  ["09:00", "9:00 AM"],
];

const KEYS = ["out_today_enabled", "out_today_time", "out_today_later"];

/** Slack replies with short codes like "not_authed"; plain sentences come from the function itself. */
function explain(error: string | undefined): string {
  if (!error) return "Slack didn't accept the message.";
  if (/^[a-z_]+$/.test(error)) return `Slack didn't accept the message (${error}).`;
  return error;
}

export default function OutTodayPostCard() {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("08:00");
  const [later, setLater] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", KEYS)
      .then(({ data }) => {
        for (const s of data ?? []) {
          if (s.key === "out_today_enabled") setEnabled(s.value === "true");
          if (s.key === "out_today_time" && s.value) setTime(s.value);
          if (s.key === "out_today_later") setLater(s.value !== "false");
        }
        setLoading(false);
      });
  }, []);

  const upsert = async (rows: { key: string; value: string }[]) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("app_settings")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "key" });
    return error;
  };

  const toggle = async (on: boolean) => {
    setEnabled(on);
    const error = await upsert([{ key: "out_today_enabled", value: String(on) }]);
    if (error) {
      setEnabled(!on);
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success(on ? "Daily message turned on." : "Daily message turned off.");
    }
  };

  const save = async () => {
    setSaving(true);
    const error = await upsert([
      { key: "out_today_time", value: time },
      { key: "out_today_later", value: String(later) },
    ]);
    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else toast.success("Daily message settings saved.");
  };

  const sendTest = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("post-out-today", { body: { test: true } });
    setTesting(false);
    if (error) {
      toast.error("The daily message isn't set up on the server yet. Ask Lovable to deploy the post-out-today edge function.");
      return;
    }
    if (data?.ok) {
      toast.success(data.testMode ? "Slack test mode is on, so the message was only logged." : "Test sent to your Time Off Manager app chat.");
    } else {
      toast.error(explain(data?.error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily "Out today" post</CardTitle>
        <CardDescription>Send who's away to managers and admins in their Time Off Manager app chat every weekday morning</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Post every weekday</p>
                <p className="text-xs text-muted-foreground">Monday to Friday, skips stat holidays and days when nobody is off</p>
              </div>
              <Switch checked={enabled} onCheckedChange={toggle} aria-label="Post every weekday" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2 min-w-0">
                <Label htmlFor="outTodayTime">Time</Label>
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger id="outTodayTime"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id="outTodayLater" checked={later} onCheckedChange={(c) => setLater(c === true)} />
              <Label htmlFor="outTodayLater" className="text-sm cursor-pointer leading-snug">Also list time off later this week</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              <Button variant="outline" onClick={sendTest} disabled={testing}>{testing ? "Sending..." : "Send a test post"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">The test goes only to you, in your Time Off Manager app chat.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
