// v2 – include half-day (start_day_portion) in all notification messages
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  request_id: string;
  notification_type:
    | "submission_confirmation"
    | "approval_request"
    | "approval_notification"
    | "rejection_notification"
    | "edit_notification"
    | "cancellation_notification"
    | "auto_approved_notification"
    | "approval_reminder"
    | "flexible_time_request"
    | "flexible_time_approved"
    | "flexible_time_rejected"
    | "flexible_time_incomplete"
    | "flexible_time_reminder";
  extra?: Record<string, string>;
  flexible_time?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload: NotificationPayload = await req.json();
    const { request_id, notification_type, extra, flexible_time } = payload;

    // Check test mode
    const { data: testModeSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "slack_test_mode")
      .single();
    const testMode = testModeSetting?.value === "true";

    // Fetch request - either time_off or flexible_time
    let request: any = null;
    let employee: any = null;
    let dateRange = "";
    let typeLabel = "";
    let specialApprovalNote = "";

    if (flexible_time) {
      const { data: flexReq, error: flexError } = await supabase
        .from("flexible_time_requests")
        .select("*")
        .eq("id", request_id)
        .single();
      if (flexError || !flexReq) throw new Error(`Flexible request not found: ${request_id}`);
      request = flexReq;

      const { data: emp } = await supabase.from("profiles").select("*").eq("id", request.employee_id).single();
      if (!emp) throw new Error("Employee profile not found");
      employee = emp;

      dateRange = `${request.date_off} ${request.start_time?.slice(0, 5)} – ${request.end_time?.slice(0, 5)} (${request.total_hours}h)`;
      typeLabel = "⏰ Flexible Time";
    } else {
      const { data: reqData, error: reqError } = await supabase
        .from("time_off_requests")
        .select("*")
        .eq("id", request_id)
        .single();
      if (reqError || !reqData) throw new Error(`Request not found: ${request_id}`);
      request = reqData;

      const { data: emp } = await supabase.from("profiles").select("*").eq("id", request.employee_id).single();
      if (!emp) throw new Error("Employee profile not found");
      employee = emp;

      const isHalfDayPm = request.start_day_portion === "pm";
      const halfDaySuffix = isHalfDayPm ? " (Afternoon off - Half Day)" : "";
      dateRange = request.request_type === "vacation"
        ? `${request.start_date} → ${request.end_date}${halfDaySuffix}`
        : (request.sick_date || "N/A") + halfDaySuffix;
      typeLabel = request.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";
      specialApprovalNote = request.requires_special_approval
        ? "\n⚠️ _(Requires special approval: within 30 days)_"
        : "";
    }
    let messages: Array<{
      slackUserId: string;
      text: string;
      blocks?: unknown[];
      messageType: string;
    }> = [];

    switch (notification_type) {
      case "submission_confirmation": {
        if (employee.slack_user_id) {
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `Your ${typeLabel} request has been submitted! Date(s): ${dateRange}`,
            messageType: "submission_confirmation",
          });
        }
        break;
      }

      case "approval_request": {
        // Send to all managers
        const { data: managerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["manager", "admin", "superadmin"]);

        if (managerRoles) {
          const managerIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles")
            .select("id, slack_user_id, full_name")
            .in("id", managerIds)
            .eq("status", "active");

          const projectId = Deno.env.get("SUPABASE_URL")?.match(
            /https:\/\/([^.]+)\./
          )?.[1];

          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `New ${typeLabel} request from ${employee.full_name}. Date(s): ${dateRange}${request.requires_special_approval ? " (Requires special approval: within 30 days)" : ""}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*New ${typeLabel} Request*\n*From:* ${employee.full_name}\n*Date(s):* ${dateRange}${isHalfDayPm ? `\n*Half Day:* Afternoon off` : ""}${request.note ? `\n*Note:* ${request.note}` : ""}${specialApprovalNote}`,
                  },
                },
                {
                  type: "actions",
                  block_id: `approval_${request_id}`,
                  elements: [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "✅ Approve" },
                      style: "primary",
                      action_id: "approve_request",
                      value: request_id,
                    },
                    {
                      type: "button",
                      text: { type: "plain_text", text: "❌ Reject" },
                      style: "danger",
                      action_id: "reject_request",
                      value: request_id,
                    },
                  ],
                },
              ],
              messageType: "approval_request",
            });
          }
        }
        break;
      }

      case "approval_notification": {
        if (employee.slack_user_id) {
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `*Your ${typeLabel} Has Been Approved!* ✅\nDate(s): ${dateRange}${request.requires_special_approval ? "\n_This request required special approval._" : ""}`,
            messageType: "approval_notification",
          });
        }
        break;
      }

      case "rejection_notification": {
        if (employee.slack_user_id) {
          const reason = extra?.rejection_reason || request.rejection_reason || "No reason provided";
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `*Your ${typeLabel} Request Was Rejected* ❌\nDate(s): ${dateRange}\nReason: ${reason}${request.requires_special_approval ? "\n_This request required special approval._" : ""}`,
            messageType: "rejection_notification",
          });
        }
        break;
      }

      case "edit_notification": {
        // Notify managers about edit
        const { data: managerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["manager", "admin", "superadmin"]);

        if (managerRoles) {
          const managerIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles")
            .select("id, slack_user_id")
            .in("id", managerIds)
            .eq("status", "active");

          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `📝 ${employee.full_name} edited their ${typeLabel} request. New date(s): ${dateRange}`,
              messageType: "edit_notification",
            });
          }
        }
        break;
      }

      case "cancellation_notification": {
        const { data: managerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["manager", "admin", "superadmin"]);

        if (managerRoles) {
          const managerIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles")
            .select("id, slack_user_id")
            .in("id", managerIds)
            .eq("status", "active");

          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `🚫 ${employee.full_name} cancelled their ${typeLabel} request (${dateRange}).${request.cancellation_reason ? ` Reason: ${request.cancellation_reason}` : ""}`,
              messageType: "cancellation_notification",
            });
          }
        }

        // Also update any active approval messages to "cancelled"
        const { data: activeMessages } = await supabase
          .from("slack_message_tracking")
          .select("*")
          .eq("request_id", request_id)
          .eq("message_type", "approval_request")
          .eq("current_state", "active");

        for (const msg of activeMessages || []) {
          if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
            await updateSlackMessage(
              SLACK_BOT_TOKEN,
              msg.slack_channel_or_dm_id,
              msg.slack_message_ts,
              `~${employee.full_name}'s ${typeLabel} request (${dateRange})~ — *Cancelled*`,
              testMode
            );
            await supabase
              .from("slack_message_tracking")
              .update({ current_state: "cancelled" })
              .eq("id", msg.id);
          }
        }
        break;
      }

      case "auto_approved_notification": {
        if (employee.slack_user_id) {
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `✅ Your ${typeLabel} (${dateRange}) has been auto-approved.`,
            messageType: "auto_approved_notification",
          });
        }
        break;
      }

      case "approval_reminder": {
        // Send reminder to all managers with approve/reject buttons
        const { data: reminderManagerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["manager", "admin", "superadmin"]);

        if (reminderManagerRoles) {
          const reminderManagerIds = [...new Set(reminderManagerRoles.map((r) => r.user_id))];
          const { data: reminderManagers } = await supabase
            .from("profiles")
            .select("id, slack_user_id")
            .in("id", reminderManagerIds)
            .eq("status", "active");

          for (const mgr of reminderManagers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `🔔 *Reminder:* ${employee.full_name}'s ${typeLabel} request (${dateRange}) is still pending your approval.${request.requires_special_approval ? " (Requires special approval: within 30 days)" : ""}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `🔔 *Reminder: Pending ${typeLabel} Request*\n*From:* ${employee.full_name}\n*Date(s):* ${dateRange}${isHalfDayPm ? `\n*Half Day:* Afternoon off` : ""}${request.note ? `\n*Note:* ${request.note}` : ""}${specialApprovalNote}`,
                  },
                },
                {
                  type: "actions",
                  block_id: `approval_${request_id}`,
                  elements: [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "✅ Approve" },
                      style: "primary",
                      action_id: "approve_request",
                      value: request_id,
                    },
                    {
                      type: "button",
                      text: { type: "plain_text", text: "❌ Reject" },
                      style: "danger",
                      action_id: "reject_request",
                      value: request_id,
                    },
                  ],
                },
              ],
              messageType: "approval_request",
            });
          }
        }
        break;
      }

      case "flexible_time_request": {
        const { data: managerRoles } = await supabase
          .from("user_roles").select("user_id").in("role", ["manager", "admin", "superadmin"]);
        if (managerRoles) {
          const managerIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles").select("id, slack_user_id").in("id", managerIds).eq("status", "active");
          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `New ${typeLabel} request from ${employee.full_name}. ${dateRange}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*📋 Action Required: ${typeLabel} Request*\n*From:* ${employee.full_name}\n*Time Off:* ${dateRange}\n*Make-up Plan:* ${request.makeup_plan || "N/A"}`,
                  },
                },
                {
                  type: "actions",
                  block_id: `flex_approval_${request_id}`,
                  elements: [
                    { type: "button", text: { type: "plain_text", text: "✅ Approve" }, style: "primary", action_id: "approve_flex_request", value: request_id },
                    { type: "button", text: { type: "plain_text", text: "❌ Reject" }, style: "danger", action_id: "reject_flex_request", value: request_id },
                  ],
                },
              ],
              messageType: "approval_request",
            });
          }
        }
        break;
      }

      case "flexible_time_approved": {
        if (employee.slack_user_id) {
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `✅ Your ${typeLabel} request (${dateRange}) has been approved!`,
            messageType: "approval_notification",
          });
        }
        break;
      }

      case "flexible_time_rejected": {
        if (employee.slack_user_id) {
          const reason = extra?.rejection_reason || request.rejection_reason || "No reason provided";
          messages.push({
            slackUserId: employee.slack_user_id,
            text: `❌ Your ${typeLabel} request (${dateRange}) was rejected. Reason: ${reason}`,
            messageType: "rejection_notification",
          });
        }
        break;
      }

      case "flexible_time_incomplete": {
        const { data: managerRoles } = await supabase
          .from("user_roles").select("user_id").in("role", ["manager", "admin", "superadmin"]);
        if (managerRoles) {
          const mgrIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles").select("id, slack_user_id").in("id", mgrIds).eq("status", "active");
          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `⚠️ *Incomplete Make-Up Time:* ${employee.full_name}'s flexible time request (${dateRange}) has incomplete make-up hours. Payroll adjustment may be needed.`,
              messageType: "cancellation_notification",
            });
          }
        }
        break;
      }

      case "flexible_time_reminder": {
        const { data: managerRoles } = await supabase
          .from("user_roles").select("user_id").in("role", ["manager", "admin", "superadmin"]);
        if (managerRoles) {
          const mgrIds = [...new Set(managerRoles.map((r) => r.user_id))];
          const { data: managers } = await supabase
            .from("profiles").select("id, slack_user_id").in("id", mgrIds).eq("status", "active");
          for (const mgr of managers || []) {
            if (!mgr.slack_user_id) continue;
            messages.push({
              slackUserId: mgr.slack_user_id,
              text: `🔔 *Reminder:* ${employee.full_name} has pending make-up hours for their flexible time request (${dateRange}). Pay period ends ${request.pay_period_end}.`,
              messageType: "edit_notification",
            });
          }
        }
        break;
      }
    }

    // Send all messages
    const results = [];
    for (const msg of messages) {
      if (testMode) {
        console.log(`[TEST MODE] Would send to ${msg.slackUserId}: ${msg.text}`);
        results.push({ slackUserId: msg.slackUserId, testMode: true });
        continue;
      }

      const slackPayload: Record<string, unknown> = {
        channel: msg.slackUserId,
        text: msg.text,
      };
      if (msg.blocks) {
        slackPayload.blocks = msg.blocks;
      }

      const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(slackPayload),
      });

      const slackData = await slackRes.json();

      // Track the message
      await supabase.from("slack_message_tracking").insert({
        request_id,
        message_type: msg.messageType as any,
        slack_message_ts: slackData.ts || null,
        slack_channel_or_dm_id: slackData.channel || msg.slackUserId,
        slack_recipient_user_id: msg.slackUserId,
        current_state: "active",
      });

      results.push({ slackUserId: msg.slackUserId, ok: slackData.ok });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending Slack notification:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function updateSlackMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
  testMode: boolean
) {
  if (testMode) {
    console.log(`[TEST MODE] Would update message ${ts} in ${channel}`);
    return;
  }
  await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, ts, text, blocks: [] }),
  });
}
