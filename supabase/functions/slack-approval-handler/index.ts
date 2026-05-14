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
    const actionId = action.action_id; // "approve_request", "reject_request", "approve_flex_request", "reject_flex_request", "approve_cancellation", "deny_cancellation", "approve_flex_cancellation", "deny_flex_cancellation"
    const isFlexible = actionId === "approve_flex_request" || actionId === "reject_flex_request";
    const isApproval = actionId === "approve_request" || actionId === "approve_flex_request";
    const isCancellationAction = ["approve_cancellation", "deny_cancellation", "approve_flex_cancellation", "deny_flex_cancellation"].includes(actionId);
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

    // ── Cancellation approve/deny branch ──────────────────────────────────────
    if (isCancellationAction) {
      const isCancelFlex = actionId === "approve_flex_cancellation" || actionId === "deny_flex_cancellation";
      const isCancelApproval = actionId === "approve_cancellation" || actionId === "approve_flex_cancellation";
      const cancelTable = isCancelFlex ? "flexible_time_requests" : "time_off_requests";

      const { data: cancelReq } = await supabase.from(cancelTable).select("*").eq("id", requestId).single();
      if (!cancelReq) {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: "⚠️ Request not found." }),
          { headers: { "Content-Type": "application/json" } });
      }
      if (cancelReq.status !== "cancel_requested") {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: `⚠️ This cancellation request has already been handled. Current status: ${cancelReq.status}.` }),
          { headers: { "Content-Type": "application/json" } });
      }

      const { data: empProfile } = await supabase.from("profiles")
        .select("full_name, slack_user_id").eq("id", cancelReq.employee_id).single();

      const cancelTypeLabel = isCancelFlex
        ? "⏰ Flexible Time"
        : cancelReq.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";
      const cancelDateRange = isCancelFlex
        ? `${cancelReq.date_off} ${cancelReq.start_time?.slice(0, 5)} – ${cancelReq.end_time?.slice(0, 5)}`
        : cancelReq.request_type === "vacation"
          ? `${cancelReq.start_date} → ${cancelReq.end_date}`
          : cancelReq.sick_date || "N/A";

      const nowIso = new Date().toISOString();
      const actionTimestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

      if (isCancelApproval) {
        // Approve: set status to cancelled, delete calendar events, DM employee
        await supabase.from(cancelTable).update({
          status: "cancelled",
          cancelled_at: nowIso,
          previous_status: null,
        }).eq("id", requestId);

        await supabase.from("audit_logs").insert({
          request_id: requestId,
          action_type: "cancellation_approved",
          actor_type: "manager",
          actor_id: manager.id,
          details: { approver_name: manager.full_name, via: "slack" },
        });

        // Delete calendar event(s) if present
        if (cancelReq.google_calendar_event_id) {
          try {
            const calBody = isCancelFlex
              ? { flexible_time_request_id: requestId, action: "delete" }
              : { request_id: requestId, action: "delete" };
            await supabase.functions.invoke("sync-google-calendar", { body: calBody });
          } catch (e) {
            console.error("Calendar delete failed:", e);
          }
        }

        if (empProfile?.slack_user_id) {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: empProfile.slack_user_id,
              text: `✅ Your cancellation request for your ${cancelTypeLabel} (${cancelDateRange}) has been approved by ${manager.full_name}. The request has been cancelled.`,
            }),
          });
        }

        const approvedBlocks = [
          { type: "section", text: { type: "mrkdwn", text: `*🚫 Cancellation Request — ${empProfile?.full_name}*` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Type:*\n${cancelTypeLabel}` },
              { type: "mrkdwn", text: `*Dates:*\n${cancelDateRange}` },
              { type: "mrkdwn", text: `*Status:*\n✅ *Cancellation Approved*` },
              { type: "mrkdwn", text: `*Approved by:*\n${manager.full_name}` },
              { type: "mrkdwn", text: `*Approved at:*\n${actionTimestamp}` },
            ],
          },
          { type: "divider" },
          { type: "context", elements: [{ type: "mrkdwn", text: "✅ Cancellation approved — the request has been cancelled." }] },
        ];

        const { data: activeCancelMsgs } = await supabase.from("slack_message_tracking").select("*")
          .eq("request_id", requestId).eq("message_type", "cancellation_request" as any).eq("current_state", "active");
        for (const msg of activeCancelMsgs || []) {
          if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
            try {
              await fetch("https://slack.com/api/chat.update", {
                method: "POST",
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ channel: msg.slack_channel_or_dm_id, ts: msg.slack_message_ts, text: `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ✅ Approved by ${manager.full_name}`, blocks: approvedBlocks }),
              });
            } catch (e) { console.error("Failed to update Slack message:", e); }
            await supabase.from("slack_message_tracking").update({ current_state: "handled" }).eq("id", msg.id);
          }
        }

        return new Response(JSON.stringify({ replace_original: true, text: `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ✅ Approved by ${manager.full_name}`, blocks: approvedBlocks }),
          { headers: { "Content-Type": "application/json" } });

      } else {
        // Deny: revert to previous_status, DM employee
        const previousStatus = cancelReq.previous_status || "approved";
        await supabase.from(cancelTable).update({
          status: previousStatus,
          previous_status: null,
        }).eq("id", requestId);

        await supabase.from("audit_logs").insert({
          request_id: requestId,
          action_type: "cancellation_denied",
          actor_type: "manager",
          actor_id: manager.id,
          details: { denier_name: manager.full_name, reverted_to: previousStatus, via: "slack" },
        });

        if (empProfile?.slack_user_id) {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: empProfile.slack_user_id,
              text: `❌ Your cancellation request for your ${cancelTypeLabel} (${cancelDateRange}) has been denied by ${manager.full_name}. The request remains active.`,
            }),
          });
        }

        const deniedBlocks = [
          { type: "section", text: { type: "mrkdwn", text: `*🚫 Cancellation Request — ${empProfile?.full_name}*` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Type:*\n${cancelTypeLabel}` },
              { type: "mrkdwn", text: `*Dates:*\n${cancelDateRange}` },
              { type: "mrkdwn", text: `*Status:*\n❌ *Cancellation Denied*` },
              { type: "mrkdwn", text: `*Denied by:*\n${manager.full_name}` },
              { type: "mrkdwn", text: `*Denied at:*\n${actionTimestamp}` },
            ],
          },
          { type: "divider" },
          { type: "context", elements: [{ type: "mrkdwn", text: "❌ Cancellation denied — the request has been restored to its previous status." }] },
        ];

        const { data: activeCancelMsgs } = await supabase.from("slack_message_tracking").select("*")
          .eq("request_id", requestId).eq("message_type", "cancellation_request" as any).eq("current_state", "active");
        for (const msg of activeCancelMsgs || []) {
          if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
            try {
              await fetch("https://slack.com/api/chat.update", {
                method: "POST",
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ channel: msg.slack_channel_or_dm_id, ts: msg.slack_message_ts, text: `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ❌ Denied by ${manager.full_name}`, blocks: deniedBlocks }),
              });
            } catch (e) { console.error("Failed to update Slack message:", e); }
            await supabase.from("slack_message_tracking").update({ current_state: "handled" }).eq("id", msg.id);
          }
        }

        return new Response(JSON.stringify({ replace_original: true, text: `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ❌ Denied by ${manager.full_name}`, blocks: deniedBlocks }),
          { headers: { "Content-Type": "application/json" } });
      }
    }
    // ── End cancellation branch ────────────────────────────────────────────────

    // Fetch the request — first-action-wins check
    let request: any = null;
    let employee: any = null;
    let dateRange = "";
    let typeLabel = "";

    if (isFlexible) {
      const { data: flexReq } = await supabase
        .from("flexible_time_requests").select("*").eq("id", requestId).single();
      if (!flexReq) {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: "⚠️ Request not found." }),
          { headers: { "Content-Type": "application/json" } });
      }
      if (flexReq.status !== "pending_approval") {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: `⚠️ This request has already been ${flexReq.status}. No action taken.` }),
          { headers: { "Content-Type": "application/json" } });
      }
      request = flexReq;
      const { data: emp } = await supabase.from("profiles").select("full_name, slack_user_id").eq("id", request.employee_id).single();
      employee = emp;
      dateRange = `${request.date_off} ${request.start_time?.slice(0, 5)} – ${request.end_time?.slice(0, 5)} (${request.total_hours}h)`;
      typeLabel = "⏰ Flexible Time";
    } else {
      const { data: reqData } = await supabase
        .from("time_off_requests").select("*").eq("id", requestId).single();
      if (!reqData) {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: "⚠️ Request not found." }),
          { headers: { "Content-Type": "application/json" } });
      }
      if (reqData.status !== "pending_approval") {
        return new Response(JSON.stringify({ response_type: "ephemeral", text: `⚠️ This request has already been ${reqData.status}. No action taken.` }),
          { headers: { "Content-Type": "application/json" } });
      }
      request = reqData;
      const { data: emp } = await supabase.from("profiles").select("full_name, slack_user_id").eq("id", request.employee_id).single();
      employee = emp;
      dateRange = request.request_type === "vacation" ? `${request.start_date} → ${request.end_date}` : request.sick_date || "N/A";
      typeLabel = request.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";
    }

    const now = new Date().toISOString();

    if (isApproval) {
      // Approve
      const table = isFlexible ? "flexible_time_requests" : "time_off_requests";
      const updateData: any = {
        status: "approved",
        approved_by_user_id: manager.id,
        approved_at: now,
      };
      if (!isFlexible) updateData.approval_source = "manager";

      await supabase.from(table).update(updateData).eq("id", requestId);

      await supabase.from("audit_logs").insert({
        request_id: requestId,
        action_type: isFlexible ? "flexible_time_approved" : "approved",
        actor_type: "manager",
        actor_id: manager.id,
        details: { via: "slack", approver_name: manager.full_name },
      });

      if (employee?.slack_user_id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: employee.slack_user_id,
            text: `✅ Your ${typeLabel} request (${dateRange}) has been approved by ${manager.full_name}!`,
          }),
        });
      }

      // Calendar sync
      try {
        const calBody = isFlexible
          ? { flexible_time_request_id: requestId, action: "create" }
          : { request_id: requestId, action: "create" };
        await supabase.functions.invoke("sync-google-calendar", { body: calBody });
      } catch (e) {
        console.error("Calendar sync failed:", e);
      }
    } else {
      // Reject
      const table = isFlexible ? "flexible_time_requests" : "time_off_requests";
      await supabase.from(table).update({
        status: "rejected",
        rejected_by_user_id: manager.id,
        rejected_at: now,
        rejection_reason: `Rejected by ${manager.full_name} via Slack`,
      }).eq("id", requestId);

      await supabase.from("audit_logs").insert({
        request_id: requestId,
        action_type: isFlexible ? "flexible_time_rejected" : "rejected",
        actor_type: "manager",
        actor_id: manager.id,
        details: { via: "slack", rejector_name: manager.full_name },
      });

      if (employee?.slack_user_id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: employee.slack_user_id,
            text: `❌ Your ${typeLabel} request (${dateRange}) has been rejected by ${manager.full_name}.`,
          }),
        });
      }
    }

    const statusText = isApproval ? "Approved" : "Rejected";
    const statusEmoji = isApproval ? "✅" : "❌";
    const actionTimestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

    // Build rich status blocks (no action buttons)
    const updatedBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${typeLabel} Request — ${employee?.full_name}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Date/Time:*\n${dateRange}` },
          { type: "mrkdwn", text: `*Status:*\n${statusEmoji} *${statusText}*` },
          { type: "mrkdwn", text: `*${isApproval ? "Approved" : "Rejected"} by:*\n${manager.full_name}` },
          { type: "mrkdwn", text: `*${isApproval ? "Approved" : "Rejected"} at:*\n${actionTimestamp}` },
        ],
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `${statusEmoji} This request has been ${statusText.toLowerCase()}. No further action needed.` },
        ],
      },
    ];

    const updatedText = `${employee?.full_name}'s ${typeLabel} request (${dateRange}) — ${statusEmoji} ${statusText} by ${manager.full_name}`;

    // Update ALL active approval messages for this request to "handled"
    const { data: activeMessages } = await supabase
      .from("slack_message_tracking")
      .select("*")
      .eq("request_id", requestId)
      .eq("message_type", "approval_request")
      .eq("current_state", "active");

    for (const msg of activeMessages || []) {
      if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
        try {
          await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: msg.slack_channel_or_dm_id,
              ts: msg.slack_message_ts,
              text: updatedText,
              blocks: updatedBlocks,
            }),
          });
        } catch (e) {
          console.error("Failed to update Slack message:", msg.id, e);
        }

        await supabase
          .from("slack_message_tracking")
          .update({ current_state: "handled" })
          .eq("id", msg.id);
      }
    }

    // Return updated message to the current interaction (replaces in-place)
    return new Response(
      JSON.stringify({
        replace_original: true,
        text: updatedText,
        blocks: updatedBlocks,
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
