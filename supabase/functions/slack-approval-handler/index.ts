import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function verifySlackSignature(
  req: Request,
  body: string,
  signingSecret: string
): Promise<boolean> {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const slackSignature = req.headers.get("x-slack-signature");

  if (!timestamp || !slackSignature) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBasestring)
  );
  const hexSig = `v0=${Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("")}`;

  return hexSig === slackSignature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");

  if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
    return new Response(JSON.stringify({ error: "Slack credentials not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.text();

    // Verify Slack signature
    const isValid = await verifySlackSignature(req, body, SLACK_SIGNING_SECRET);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse URL-encoded payload from Slack interactive messages
    const params = new URLSearchParams(body);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      return new Response("Missing payload", { status: 400 });
    }

    const payload = JSON.parse(payloadStr);
    const action = payload.actions?.[0];
    if (!action) {
      return new Response("No action found", { status: 400 });
    }

    const requestId = action.value;
    const actionId = action.action_id; // "approve_request" or "reject_request"
    const slackUserId = payload.user?.id;
    const messageTs = payload.message?.ts;
    const channelId = payload.channel?.id;

    // Look up the manager by slack_user_id
    const { data: manager } = await supabase
      .from("profiles")
      .select("id, full_name, slack_user_id")
      .eq("slack_user_id", slackUserId)
      .single();

    if (!manager) {
      // Respond ephemerally
      return new Response(
        JSON.stringify({
          response_type: "ephemeral",
          text: "⚠️ Your Slack account is not linked to the system. Contact an admin.",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify manager has the right role
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", manager.id);

    const managerRoles = roles?.map((r) => r.role) || [];
    const isManagerOrAdmin = managerRoles.some((r) =>
      ["manager", "office_manager", "admin", "superadmin"].includes(r)
    );

    if (!isManagerOrAdmin) {
      return new Response(
        JSON.stringify({
          response_type: "ephemeral",
          text: "⚠️ You don't have permission to approve/reject requests.",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch the request — first-action-wins check
    const { data: request } = await supabase
      .from("time_off_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (!request) {
      return new Response(
        JSON.stringify({
          response_type: "ephemeral",
          text: "⚠️ Request not found.",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.status !== "pending_approval") {
      // Already handled — update this message
      return new Response(
        JSON.stringify({
          response_type: "ephemeral",
          text: `⚠️ This request has already been ${request.status}. No action taken.`,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Get employee info
    const { data: employee } = await supabase
      .from("profiles")
      .select("full_name, slack_user_id")
      .eq("id", request.employee_id)
      .single();

    const dateRange =
      request.request_type === "vacation"
        ? `${request.start_date} → ${request.end_date}`
        : request.sick_date || "N/A";
    const typeLabel = request.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";

    const now = new Date().toISOString();

    if (actionId === "approve_request") {
      // Approve
      await supabase
        .from("time_off_requests")
        .update({
          status: "approved",
          approved_by_user_id: manager.id,
          approved_at: now,
          approval_source: "manager",
        })
        .eq("id", requestId);

      // Audit log
      await supabase.from("audit_logs").insert({
        request_id: requestId,
        action_type: "approved",
        actor_type: "manager",
        actor_id: manager.id,
        details: { via: "slack", approver_name: manager.full_name },
      });

      // Notify employee
      if (employee?.slack_user_id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: employee.slack_user_id,
            text: `✅ Your ${typeLabel} request (${dateRange}) has been approved by ${manager.full_name}!`,
          }),
        });
      }

      // Trigger calendar sync
      try {
        await supabase.functions.invoke("sync-google-calendar", {
          body: { request_id: requestId, action: "create" },
        });
      } catch (e) {
        console.error("Calendar sync failed:", e);
      }
    } else if (actionId === "reject_request") {
      // Reject
      await supabase
        .from("time_off_requests")
        .update({
          status: "rejected",
          rejected_by_user_id: manager.id,
          rejected_at: now,
          rejection_reason: `Rejected by ${manager.full_name} via Slack`,
        })
        .eq("id", requestId);

      // Audit log
      await supabase.from("audit_logs").insert({
        request_id: requestId,
        action_type: "rejected",
        actor_type: "manager",
        actor_id: manager.id,
        details: { via: "slack", rejector_name: manager.full_name },
      });

      // Notify employee
      if (employee?.slack_user_id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: employee.slack_user_id,
            text: `❌ Your ${typeLabel} request (${dateRange}) has been rejected by ${manager.full_name}.`,
          }),
        });
      }
    }

    // Update ALL active approval messages for this request to "handled"
    const { data: activeMessages } = await supabase
      .from("slack_message_tracking")
      .select("*")
      .eq("request_id", requestId)
      .eq("message_type", "approval_request")
      .eq("current_state", "active");

    const statusText = actionId === "approve_request" ? "Approved" : "Rejected";

    for (const msg of activeMessages || []) {
      if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
        await fetch("https://slack.com/api/chat.update", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: msg.slack_channel_or_dm_id,
            ts: msg.slack_message_ts,
            text: `${employee?.full_name}'s ${typeLabel} request (${dateRange}) — *${statusText}* by ${manager.full_name}`,
            blocks: [],
          }),
        });

        await supabase
          .from("slack_message_tracking")
          .update({ current_state: "handled" })
          .eq("id", msg.id);
      }
    }

    // Return updated message to the current interaction
    return new Response(
      JSON.stringify({
        replace_original: true,
        text: `${employee?.full_name}'s ${typeLabel} request (${dateRange}) — *${statusText}* by ${manager.full_name}`,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error handling Slack approval:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
