// v2 – respond to Slack immediately (< 3s), process everything in the background
// Slack's interactive component webhook requires an HTTP 200 within 3 seconds.
// All DB work, calendar sync, and follow-up messages happen via EdgeRuntime.waitUntil()
// so the runtime stays alive after the response is sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Slack signature verification ──────────────────────────────────────────────

async function verifySlackSignature(
  req: Request,
  body: string,
  signingSecret: string
): Promise<boolean> {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const slackSig  = req.headers.get("x-slack-signature");
  if (!timestamp || !slackSig) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false; // replay protection

  const base = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const hex = `v0=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return hex === slackSig;
}

// ── Slack API helpers ─────────────────────────────────────────────────────────

async function updateSlack(
  token: string, channel: string, ts: string,
  text: string, blocks: unknown[]
): Promise<void> {
  const r = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, ts, text, blocks }),
  });
  const d = await r.json();
  if (!d.ok) console.error("[slack-handler] chat.update error:", d.error, "channel:", channel);
}

async function sendDM(token: string, channel: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN    = Deno.env.get("SLACK_BOT_TOKEN");
  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");

  if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
    console.error("[slack-handler] Missing Slack credentials");
    return new Response(
      JSON.stringify({ error: "Slack credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Read body once — needed for both signature verification and payload parsing
  const body = await req.text();

  // Verify Slack signature BEFORE doing anything else
  const isValid = await verifySlackSignature(req, body, SLACK_SIGNING_SECRET);
  if (!isValid) {
    console.error("[slack-handler] Invalid Slack signature — rejecting");
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse the URL-encoded Slack interactive payload
  const params     = new URLSearchParams(body);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return new Response("Missing payload", { status: 400 });
  }

  let slackPayload: any;
  try {
    slackPayload = JSON.parse(payloadStr);
  } catch {
    return new Response("Invalid payload JSON", { status: 400 });
  }

  const action = slackPayload.actions?.[0];
  if (!action) return new Response("No action found", { status: 400 });

  const channelId: string = slackPayload.channel?.id  ?? "";
  const messageTs: string = slackPayload.message?.ts  ?? "";

  console.log(
    `[slack-handler] Received action=${action.action_id} value=${action.value}` +
    ` channel=${channelId} ts=${messageTs}`
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Schedule all heavy work in the background.
  // EdgeRuntime.waitUntil() keeps the function alive after the response is sent.
  const backgroundTask = processInteraction(
    slackPayload, action, supabase, SLACK_BOT_TOKEN, channelId, messageTs
  ).catch((err) => {
    console.error("[slack-handler] Background processing error:", err);
    // Try to show an error state in the Slack message
    if (channelId && messageTs) {
      updateSlack(
        SLACK_BOT_TOKEN, channelId, messageTs,
        "⚠️ An error occurred while processing this request. Please try again.",
        []
      ).catch(() => {/* best effort */});
    }
  });

  // @ts-ignore – EdgeRuntime is injected by Supabase's edge runtime
  if (typeof EdgeRuntime !== "undefined") {
    // @ts-ignore
    EdgeRuntime.waitUntil(backgroundTask);
  }
  // Note: even without EdgeRuntime, the floating promise will run in Supabase's
  // Deno isolate until the function terminates. EdgeRuntime.waitUntil() is the
  // reliable way to guarantee it finishes.

  // ── Respond to Slack IMMEDIATELY (must be within 3 seconds) ─────────────────
  console.log(`[slack-handler] Sending immediate 200 ack for ${action.action_id}`);
  return new Response(
    JSON.stringify({
      replace_original: true,
      text: "⏳ Processing your request...",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "⏳ _Processing your request..._" },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// ── Background processing ─────────────────────────────────────────────────────

async function processInteraction(
  payload: any,
  action: any,
  supabase: any,
  token: string,
  channelId: string,
  messageTs: string
): Promise<void> {
  const requestId: string = action.value;
  const actionId:  string = action.action_id;
  const slackUserId: string = payload.user?.id ?? "";

  console.log(
    `[slack-handler] Processing: actionId=${actionId}` +
    ` requestId=${requestId} slackUser=${slackUserId}`
  );

  // Look up the manager by their Slack user ID
  const { data: manager } = await supabase
    .from("profiles")
    .select("id, full_name, slack_user_id")
    .eq("slack_user_id", slackUserId)
    .single();

  if (!manager) {
    console.error(`[slack-handler] No profile for Slack user ${slackUserId}`);
    await sendDM(token, slackUserId,
      "⚠️ Your Slack account is not linked to the system. Contact an admin.");
    if (channelId && messageTs) {
      await updateSlack(token, channelId, messageTs,
        "⚠️ Action failed — your Slack account is not linked.", []);
    }
    return;
  }

  console.log(`[slack-handler] Manager identified: ${manager.full_name} (${manager.id})`);

  // Verify the manager role
  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", manager.id);
  const isManagerOrAdmin = (roles ?? [])
    .map((r: any) => r.role)
    .some((r: string) =>
      ["manager", "office_manager", "admin", "superadmin"].includes(r)
    );

  if (!isManagerOrAdmin) {
    console.warn(`[slack-handler] ${manager.full_name} lacks manager/admin role`);
    await sendDM(token, slackUserId,
      "⚠️ You don't have permission to approve or reject requests.");
    if (channelId && messageTs) {
      await updateSlack(token, channelId, messageTs,
        "⚠️ Action failed — insufficient permissions.", []);
    }
    return;
  }

  const isCancellationAction = [
    "approve_cancellation", "deny_cancellation",
    "approve_flex_cancellation", "deny_flex_cancellation",
  ].includes(actionId);

  if (isCancellationAction) {
    await handleCancellation(
      actionId, requestId, manager, supabase, token, channelId, messageTs
    );
    return;
  }

  const isFlexible = actionId === "approve_flex_request" || actionId === "reject_flex_request";
  const isApproval = actionId === "approve_request"      || actionId === "approve_flex_request";
  await handleApproval(
    isFlexible, isApproval, requestId, manager, supabase, token, channelId, messageTs
  );
}

// ── Approval / Rejection ──────────────────────────────────────────────────────

async function handleApproval(
  isFlexible: boolean,
  isApproval: boolean,
  requestId: string,
  manager: any,
  supabase: any,
  token: string,
  channelId: string,
  messageTs: string
): Promise<void> {
  const table = isFlexible ? "flexible_time_requests" : "time_off_requests";

  console.log(
    `[slack-handler] ${isApproval ? "Approving" : "Rejecting"}` +
    ` ${isFlexible ? "flex" : "regular"} request ${requestId}`
  );

  const { data: request } = await supabase
    .from(table).select("*").eq("id", requestId).single();

  if (!request) {
    console.error(`[slack-handler] Request ${requestId} not found in ${table}`);
    await updateSlack(token, channelId, messageTs, "⚠️ Request not found.", []);
    return;
  }

  if (request.status !== "pending_approval") {
    console.warn(
      `[slack-handler] Request ${requestId} already in status: ${request.status}`
    );
    await updateSlack(
      token, channelId, messageTs,
      `⚠️ This request has already been ${request.status}. No action taken.`,
      []
    );
    return;
  }

  const { data: employee } = await supabase
    .from("profiles")
    .select("full_name, slack_user_id")
    .eq("id", request.employee_id)
    .single();

  const typeLabel = isFlexible
    ? "⏰ Flexible Time"
    : request.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";
  const dateRange = isFlexible
    ? `${request.date_off} ${request.start_time?.slice(0, 5)} – ${request.end_time?.slice(0, 5)} (${request.total_hours}h)`
    : request.request_type === "vacation"
      ? `${request.start_date} → ${request.end_date}`
      : (request.sick_date || "N/A");

  const nowIso = new Date().toISOString();
  const actionTimestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });

  if (isApproval) {
    // ── Approve ──
    const updateData: any = {
      status: "approved",
      approved_by_user_id: manager.id,
      approved_at: nowIso,
    };
    if (!isFlexible) updateData.approval_source = "manager";

    await supabase.from(table).update(updateData).eq("id", requestId);
    console.log(`[slack-handler] DB → approved for ${requestId}`);

    await supabase.from("audit_logs").insert({
      request_id: requestId,
      action_type: isFlexible ? "flexible_time_approved" : "approved",
      actor_type: "manager",
      actor_id: manager.id,
      details: { via: "slack", approver_name: manager.full_name },
    });

    if (employee?.slack_user_id) {
      await sendDM(
        token, employee.slack_user_id,
        `✅ Your ${typeLabel} request (${dateRange}) has been approved by ${manager.full_name}!`
      );
    }

    // Create Google Calendar events NOW (after approval, never before)
    console.log(`[slack-handler] Triggering calendar sync (create) for ${requestId}`);
    try {
      const calBody = isFlexible
        ? { flexible_time_request_id: requestId, action: "create" }
        : { request_id: requestId, action: "create" };
      const { error: calError } = await supabase.functions.invoke(
        "sync-google-calendar", { body: calBody }
      );
      if (calError) console.error("[slack-handler] Calendar sync error:", calError);
      else console.log(`[slack-handler] Calendar sync done for ${requestId}`);
    } catch (e) {
      console.error("[slack-handler] Calendar sync threw:", e);
    }
  } else {
    // ── Reject ──
    await supabase.from(table).update({
      status: "rejected",
      rejected_by_user_id: manager.id,
      rejected_at: nowIso,
      rejection_reason: `Rejected by ${manager.full_name} via Slack`,
    }).eq("id", requestId);
    console.log(`[slack-handler] DB → rejected for ${requestId}`);

    await supabase.from("audit_logs").insert({
      request_id: requestId,
      action_type: isFlexible ? "flexible_time_rejected" : "rejected",
      actor_type: "manager",
      actor_id: manager.id,
      details: { via: "slack", rejector_name: manager.full_name },
    });

    if (employee?.slack_user_id) {
      await sendDM(
        token, employee.slack_user_id,
        `❌ Your ${typeLabel} request (${dateRange}) has been rejected by ${manager.full_name}.`
      );
    }
  }

  const statusText  = isApproval ? "Approved" : "Rejected";
  const statusEmoji = isApproval ? "✅" : "❌";
  const finalText = (
    `${employee?.full_name}'s ${typeLabel} request (${dateRange})` +
    ` — ${statusEmoji} ${statusText} by ${manager.full_name}`
  );
  const finalBlocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${typeLabel} Request — ${employee?.full_name}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Date/Time:*\n${dateRange}` },
        { type: "mrkdwn", text: `*Status:*\n${statusEmoji} *${statusText}*` },
        {
          type: "mrkdwn",
          text: `*${isApproval ? "Approved" : "Rejected"} by:*\n${manager.full_name}`,
        },
        { type: "mrkdwn", text: `*At:*\n${actionTimestamp}` },
      ],
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${statusEmoji} This request has been ${statusText.toLowerCase()}. No further action needed.`,
        },
      ],
    },
  ];

  // Update all tracked approval messages (other managers who received the DM)
  const { data: tracked } = await supabase
    .from("slack_message_tracking")
    .select("*")
    .eq("request_id", requestId)
    .eq("message_type", "approval_request")
    .eq("current_state", "active");

  for (const msg of tracked ?? []) {
    if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
      try {
        await updateSlack(
          token, msg.slack_channel_or_dm_id, msg.slack_message_ts,
          finalText, finalBlocks
        );
      } catch (e) {
        console.error("[slack-handler] Failed to update tracked msg:", msg.id, e);
      }
      await supabase
        .from("slack_message_tracking")
        .update({ current_state: "handled" })
        .eq("id", msg.id);
    }
  }

  // Always update the message that triggered THIS interaction as well
  // (it may not be in the tracking table for flex requests due to FK constraint)
  if (channelId && messageTs) {
    try {
      await updateSlack(token, channelId, messageTs, finalText, finalBlocks);
    } catch (e) {
      console.error("[slack-handler] Failed to update triggering message:", e);
    }
  }

  console.log(
    `[slack-handler] Completed ${isApproval ? "approval" : "rejection"} for ${requestId}`
  );
}

// ── Cancellation Approve / Deny ───────────────────────────────────────────────

async function handleCancellation(
  actionId: string,
  requestId: string,
  manager: any,
  supabase: any,
  token: string,
  channelId: string,
  messageTs: string
): Promise<void> {
  const isCancelFlex    = actionId === "approve_flex_cancellation" || actionId === "deny_flex_cancellation";
  const isCancelApprove = actionId === "approve_cancellation"      || actionId === "approve_flex_cancellation";
  const cancelTable     = isCancelFlex ? "flexible_time_requests" : "time_off_requests";

  console.log(
    `[slack-handler] Cancellation: ${actionId} for ${requestId} (${cancelTable})`
  );

  const { data: cancelReq } = await supabase
    .from(cancelTable).select("*").eq("id", requestId).single();

  if (!cancelReq) {
    console.error(`[slack-handler] Cancellation request ${requestId} not found`);
    await updateSlack(token, channelId, messageTs, "⚠️ Request not found.", []);
    return;
  }

  if (cancelReq.status !== "cancel_requested") {
    console.warn(
      `[slack-handler] Cancellation ${requestId} already handled, status: ${cancelReq.status}`
    );
    await updateSlack(
      token, channelId, messageTs,
      `⚠️ This cancellation has already been handled. Current status: ${cancelReq.status}.`,
      []
    );
    return;
  }

  const { data: empProfile } = await supabase
    .from("profiles")
    .select("full_name, slack_user_id")
    .eq("id", cancelReq.employee_id)
    .single();

  const cancelTypeLabel = isCancelFlex
    ? "⏰ Flexible Time"
    : cancelReq.request_type === "vacation" ? "🏖️ Vacation" : "🤒 Sick Day";
  const cancelDateRange = isCancelFlex
    ? `${cancelReq.date_off} ${cancelReq.start_time?.slice(0, 5)} – ${cancelReq.end_time?.slice(0, 5)}`
    : cancelReq.request_type === "vacation"
      ? `${cancelReq.start_date} → ${cancelReq.end_date}`
      : (cancelReq.sick_date || "N/A");

  const nowIso = new Date().toISOString();
  const actionTimestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });

  if (isCancelApprove) {
    await supabase.from(cancelTable).update({
      status: "cancelled",
      cancelled_at: nowIso,
      previous_status: null,
    }).eq("id", requestId);
    console.log(`[slack-handler] DB → cancelled for ${requestId}`);

    await supabase.from("audit_logs").insert({
      request_id: requestId,
      action_type: "cancellation_approved",
      actor_type: "manager",
      actor_id: manager.id,
      details: { approver_name: manager.full_name, via: "slack" },
    });

    // Delete calendar events
    if (cancelReq.google_calendar_event_id) {
      console.log(`[slack-handler] Deleting calendar events for ${requestId}`);
      try {
        const calBody = isCancelFlex
          ? { flexible_time_request_id: requestId, action: "delete" }
          : { request_id: requestId, action: "delete" };
        await supabase.functions.invoke("sync-google-calendar", { body: calBody });
      } catch (e) {
        console.error("[slack-handler] Calendar delete failed:", e);
      }
    }

    if (empProfile?.slack_user_id) {
      await sendDM(token, empProfile.slack_user_id,
        `✅ Your cancellation request for your ${cancelTypeLabel} (${cancelDateRange})` +
        ` has been approved by ${manager.full_name}. The request has been cancelled.`
      );
    }

    const resultText = `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ✅ Approved by ${manager.full_name}`;
    const resultBlocks = buildCancellationBlocks(
      empProfile?.full_name, cancelTypeLabel, cancelDateRange,
      manager.full_name, actionTimestamp, true
    );
    await updateTrackedCancellationMsgs(
      supabase, token, requestId, resultText, resultBlocks
    );
    if (channelId && messageTs) {
      await updateSlack(token, channelId, messageTs, resultText, resultBlocks);
    }
  } else {
    // Deny — revert to previous status
    const previousStatus = cancelReq.previous_status || "approved";
    await supabase.from(cancelTable).update({
      status: previousStatus,
      previous_status: null,
    }).eq("id", requestId);
    console.log(`[slack-handler] DB → ${previousStatus} (denied) for ${requestId}`);

    await supabase.from("audit_logs").insert({
      request_id: requestId,
      action_type: "cancellation_denied",
      actor_type: "manager",
      actor_id: manager.id,
      details: {
        denier_name: manager.full_name,
        reverted_to: previousStatus,
        via: "slack",
      },
    });

    if (empProfile?.slack_user_id) {
      await sendDM(token, empProfile.slack_user_id,
        `❌ Your cancellation request for your ${cancelTypeLabel} (${cancelDateRange})` +
        ` has been denied by ${manager.full_name}. Your request remains active.`
      );
    }

    const resultText = `${empProfile?.full_name}'s ${cancelTypeLabel} cancellation — ❌ Denied by ${manager.full_name}`;
    const resultBlocks = buildCancellationBlocks(
      empProfile?.full_name, cancelTypeLabel, cancelDateRange,
      manager.full_name, actionTimestamp, false
    );
    await updateTrackedCancellationMsgs(
      supabase, token, requestId, resultText, resultBlocks
    );
    if (channelId && messageTs) {
      await updateSlack(token, channelId, messageTs, resultText, resultBlocks);
    }
  }

  console.log(
    `[slack-handler] Cancellation ${isCancelApprove ? "approved" : "denied"} for ${requestId}`
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCancellationBlocks(
  employeeName: string | undefined,
  typeLabel: string,
  dateRange: string,
  managerName: string,
  timestamp: string,
  approved: boolean
): unknown[] {
  const emoji      = approved ? "✅" : "❌";
  const statusText = approved ? "Cancellation Approved" : "Cancellation Denied";
  const actionWord = approved ? "Approved" : "Denied";
  const outcome    = approved
    ? "the request has been cancelled"
    : "the request has been restored to its previous status";
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🚫 Cancellation Request — ${employeeName}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Type:*\n${typeLabel}` },
        { type: "mrkdwn", text: `*Dates:*\n${dateRange}` },
        { type: "mrkdwn", text: `*Status:*\n${emoji} *${statusText}*` },
        { type: "mrkdwn", text: `*${actionWord} by:*\n${managerName}` },
        { type: "mrkdwn", text: `*At:*\n${timestamp}` },
      ],
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `${emoji} ${statusText} — ${outcome}.` },
      ],
    },
  ];
}

async function updateTrackedCancellationMsgs(
  supabase: any,
  token: string,
  requestId: string,
  text: string,
  blocks: unknown[]
): Promise<void> {
  const { data: tracked } = await supabase
    .from("slack_message_tracking")
    .select("*")
    .eq("request_id", requestId)
    .eq("message_type", "cancellation_request")
    .eq("current_state", "active");

  for (const msg of tracked ?? []) {
    if (msg.slack_message_ts && msg.slack_channel_or_dm_id) {
      try {
        await updateSlack(
          token, msg.slack_channel_or_dm_id, msg.slack_message_ts, text, blocks
        );
      } catch (e) {
        console.error("[slack-handler] Failed to update cancellation msg:", msg.id, e);
      }
      await supabase
        .from("slack_message_tracking")
        .update({ current_state: "handled" })
        .eq("id", msg.id);
    }
  }
}
