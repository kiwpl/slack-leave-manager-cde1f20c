import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

type AuditLog = Tables<"audit_logs">;

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  useEffect(() => {
    let query = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (actionFilter !== "all") query = query.eq("action_type", actionFilter);

    query.then(({ data }) => {
      setLogs(data || []);
      setLoading(false);
    });
  }, [actionFilter]);

  const filtered = logs.filter((log) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      log.action_type.toLowerCase().includes(s) ||
      log.actor_type.toLowerCase().includes(s) ||
      JSON.stringify(log.details).toLowerCase().includes(s)
    );
  });

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          <p className="text-muted-foreground">Complete history of all actions</p>
        </div>

        <div className="flex gap-3">
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="request_submitted">Submitted</SelectItem>
              <SelectItem value="request_edited">Edited</SelectItem>
              <SelectItem value="request_cancelled">Cancelled</SelectItem>
              <SelectItem value="sick_day_auto_approved">Auto-Approved</SelectItem>
              <SelectItem value="approved_request_edited">Approved Edited</SelectItem>
              <SelectItem value="rejected_request_resubmitted">Resubmitted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit logs found.</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start justify-between p-3 rounded-lg border border-border"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {log.action_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Actor: {log.actor_type} · Request: {log.request_id?.substring(0, 8) || "N/A"}
                      </p>
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          {JSON.stringify(log.details).substring(0, 120)}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
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
