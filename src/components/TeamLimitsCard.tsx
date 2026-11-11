import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatRange } from "@/components/TeamLimitsAlert";

/**
 * Admin Settings card: the most people off at once, blocked dates, and
 * whether hitting either only warns or stops the request being submitted.
 */

interface Blocked {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
}

export default function TeamLimitsCard() {
  const { user } = useAuth();
  const [max, setMax] = useState("");
  const [mode, setMode] = useState<"warn" | "block">("warn");
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadBlocked = async () => {
    const { data, error } = await supabase
      .from("blocked_dates")
      .select("id, start_date, end_date, reason")
      .order("start_date");
    if (error) {
      console.error("Team limits: could not load blocked dates", error);
      setTableMissing(true);
      return;
    }
    setTableMissing(false);
    setBlocked(data ?? []);
  };

  useEffect(() => {
    Promise.all([
      supabase.from("app_settings").select("key, value").in("key", ["team_limit_max", "team_limit_mode"]),
      loadBlocked(),
    ]).then(([{ data }]) => {
      for (const s of data ?? []) {
        if (s.key === "team_limit_max") setMax(s.value);
        if (s.key === "team_limit_mode") setMode(s.value === "block" ? "block" : "warn");
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    const n = parseInt(max, 10);
    const value = n > 0 ? String(n) : "";
    setMax(value);
    setSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert(
      [
        { key: "team_limit_max", value, updated_at: now },
        { key: "team_limit_mode", value: mode, updated_at: now },
      ],
      { onConflict: "key" }
    );
    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else toast.success("Team limits saved.");
  };

  const add = async () => {
    const err = !from || !to
      ? "Pick a start and end date."
      : from > to
        ? "The end date must be on or after the start date."
        : !reason.trim()
          ? "Add a reason so people know why."
          : "";
    setAddError(err);
    if (err) return;
    setAdding(true);
    const { error } = await supabase
      .from("blocked_dates")
      .insert({ start_date: from, end_date: to, reason: reason.trim(), created_by: user?.id ?? null });
    setAdding(false);
    if (error) {
      setAddError("Could not add the blocked dates: " + error.message);
      return;
    }
    setFrom("");
    setTo("");
    setReason("");
    toast.success("Blocked dates added.");
    loadBlocked();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("blocked_dates").delete().eq("id", id);
    if (error) {
      toast.error("Could not remove: " + error.message);
      return;
    }
    toast.success("Blocked dates removed.");
    loadBlocked();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team limits</CardTitle>
        <CardDescription>Stop too many people from being off at the same time</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="teamLimitMax">Most people off at once</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="teamLimitMax"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  className="w-24"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">people</span>
              </div>
              <p className="text-xs text-muted-foreground">Counts approved and pending vacation. Leave empty for no limit.</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Blocked dates</p>
              {tableMissing ? (
                <p className="text-sm text-destructive">
                  Blocked dates aren't set up in the database yet. Run the team limits SQL in Supabase Dashboard &gt; SQL Editor.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    {blocked.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No blocked dates.</p>
                    ) : (
                      blocked.map((b) => (
                        <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border bg-card">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{formatRange(b.start_date, b.end_date)}</p>
                            <p className="text-xs text-muted-foreground break-words">{b.reason}</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => remove(b.id)}>Remove</Button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-end pt-1">
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor="blockedFrom" className="text-xs text-muted-foreground font-normal">From</Label>
                      <Input id="blockedFrom" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor="blockedTo" className="text-xs text-muted-foreground font-normal">To</Label>
                      <Input id="blockedTo" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor="blockedReason" className="text-xs text-muted-foreground font-normal">Reason</Label>
                      <Input id="blockedReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Year-end inventory" />
                    </div>
                    <Button variant="outline" onClick={add} disabled={adding}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  {addError && <p className="text-sm text-destructive">{addError}</p>}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="teamLimitMode" className="block leading-snug">When a request hits a blocked date or the limit</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "warn" | "block")}>
                <SelectTrigger id="teamLimitMode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warn">Warn them, manager decides</SelectItem>
                  <SelectItem value="block">Don't let them submit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
