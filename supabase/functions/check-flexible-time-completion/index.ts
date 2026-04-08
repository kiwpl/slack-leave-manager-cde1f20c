import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getPayPeriodMidpoint(start: string, end: string): string {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const mid = new Date(s.getTime() + (e.getTime() - s.getTime()) / 2);
  return mid.toISOString().split("T")[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Auto-complete makeup entries whose date has passed
    await supabase
      .from("flexible_time_makeup_entries")
      .update({ completed: true })
      .eq("completed", false)
      .lte("makeup_date", today);

    // 2. Check approved requests where pay period has ended
    const { data: endedRequests } = await supabase
      .from("flexible_time_requests")
      .select("*")
      .eq("status", "approved")
      .lte("pay_period_end", today);

    for (const req of endedRequests || []) {
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries")
        .select("*")
        .eq("request_id", req.id);

      const allCompleted = (entries || []).every((e: any) => e.completed);

      if (allCompleted) {
        await supabase
          .from("flexible_time_requests")
          .update({ status: "completed" })
          .eq("id", req.id);

        await supabase.from("audit_logs").insert({
          request_id: req.id,
          action_type: "flexible_time_completed",
          actor_type: "system",
          actor_id: null,
        });
      } else {
        await supabase
          .from("flexible_time_requests")
          .update({ status: "incomplete" })
          .eq("id", req.id);

        await supabase.from("audit_logs").insert({
          request_id: req.id,
          action_type: "flexible_time_incomplete",
          actor_type: "system",
          actor_id: null,
        });

        // Update calendar event titles
        try {
          await supabase.functions.invoke("sync-google-calendar", {
            body: { flexible_time_request_id: req.id, action: "update_incomplete" },
          });
        } catch (e) {
          console.error("Calendar update failed:", e);
        }

        // Notify managers and admin
        try {
          await supabase.functions.invoke("send-slack-notification", {
            body: {
              request_id: req.id,
              notification_type: "flexible_time_incomplete",
              flexible_time: true,
            },
          });
        } catch (e) {
          console.error("Slack notification failed:", e);
        }
      }
    }

    // 3. Mid-period reminders for approved requests
    const { data: activeRequests } = await supabase
      .from("flexible_time_requests")
      .select("*")
      .eq("status", "approved")
      .gt("pay_period_end", today);

    for (const req of activeRequests || []) {
      const midpoint = getPayPeriodMidpoint(req.pay_period_start, req.pay_period_end);
      if (today === midpoint) {
        const { data: pendingEntries } = await supabase
          .from("flexible_time_makeup_entries")
          .select("id")
          .eq("request_id", req.id)
          .eq("completed", false)
          .gt("makeup_date", today);

        if ((pendingEntries?.length || 0) > 0) {
          try {
            await supabase.functions.invoke("send-slack-notification", {
              body: {
                request_id: req.id,
                notification_type: "flexible_time_reminder",
                flexible_time: true,
              },
            });
          } catch (e) {
            console.error("Reminder failed:", e);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Completion check error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
