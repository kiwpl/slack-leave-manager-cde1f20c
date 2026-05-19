// v5 – plain local-time dateTime strings + explicit timeZone field (no UTC conversion)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SyncPayload {
  request_id?: string;
  flexible_time_request_id?: string;
  action: "create" | "delete" | "update_incomplete" | "retroactive_fix";
}

// Strip any timezone offset or microseconds from a Supabase time column value.
// PostgreSQL `time without time zone` can come back as "HH:MM:SS+00" or "HH:MM:SS.000000".
// We only want "HH:MM:SS" so the bare local-time string paired with the timeZone
// field is unambiguous to the Google Calendar API.
function normalizeTime(t: string): string {
  const m = (t || "").match(/^(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : t;
}

// Ensure date strings are always "YYYY-MM-DD" (10 chars).
function normalizeDate(d: string): string {
  return (d || "").substring(0, 10);
}

// Add one calendar day to a YYYY-MM-DD string using safe UTC arithmetic.
// Used to produce the exclusive end-date for Google Calendar all-day events.
function nextDay(dateStr: string): string {
  const [y, m, d] = normalizeDate(dateStr).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().split("T")[0];
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsignedToken = `${encode(header)}.${encode(claim)}`;

  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = sa.private_key
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsignedToken}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// Retroactive fix: patch all Flexible Time Request calendar events that were
// stored with wrong times. Reads the correct local times from the database
// and sends them to Google Calendar as plain local-time strings paired with
// the company timezone, which is the correct approach.
async function runRetroactiveFix(
  supabase: any,
  calendarApiBase: string,
  accessToken: string,
  companyTimezone: string
): Promise<unknown[]> {
  const corrections: unknown[] = [];

  console.log(`[retroactive-fix] Running with timezone: ${companyTimezone}`);

  const { data: allFlexReqs } = await supabase
    .from("flexible_time_requests")
    .select("*")
    .not("google_calendar_event_id", "is", null);

  for (const req of allFlexReqs || []) {
    const { data: employee } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", req.employee_id)
      .single();
    const name = employee?.full_name || "Unknown";

    // Plain local-time strings — Google Calendar interprets them using timeZone field
    const correctStart = `${normalizeDate(req.date_off)}T${normalizeTime(req.start_time)}`;
    const correctEnd   = `${normalizeDate(req.date_off)}T${normalizeTime(req.end_time)}`;

    const checkRes = await fetch(
      `${calendarApiBase}/events/${encodeURIComponent(req.google_calendar_event_id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!checkRes.ok) {
      corrections.push({
        requestId: req.id,
        type: "time_off_skipped",
        eventId: req.google_calendar_event_id,
        reason: checkRes.status === 404 || checkRes.status === 410
          ? "event_deleted"
          : `http_${checkRes.status}`,
      });
    } else {
      const existing = await checkRes.json();
      const oldStart = existing.start?.dateTime ?? existing.start?.date ?? "unknown";

      const patchRes = await fetch(
        `${calendarApiBase}/events/${encodeURIComponent(req.google_calendar_event_id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: `Flexible Time Off – ${name}`,
            start: { dateTime: correctStart, timeZone: companyTimezone },
            end:   { dateTime: correctEnd,   timeZone: companyTimezone },
          }),
        }
      );

      if (patchRes.ok) {
        corrections.push({
          requestId: req.id,
          type: "time_off_patched",
          eventId: req.google_calendar_event_id,
          oldStart,
          newStart: correctStart,
          timezone: companyTimezone,
        });
      } else {
        const err = await patchRes.text();
        corrections.push({
          requestId: req.id,
          type: "time_off_patch_failed",
          eventId: req.google_calendar_event_id,
          error: err,
        });
      }
    }

    // Patch each makeup entry event
    const { data: entries } = await supabase
      .from("flexible_time_makeup_entries")
      .select("*")
      .eq("request_id", req.id)
      .not("google_calendar_event_id", "is", null);

    for (const entry of entries || []) {
      const muStart = `${normalizeDate(entry.makeup_date)}T${normalizeTime(entry.start_time)}`;
      const muEnd   = `${normalizeDate(entry.makeup_date)}T${normalizeTime(entry.end_time)}`;

      const muCheck = await fetch(
        `${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!muCheck.ok) {
        corrections.push({
          requestId: req.id,
          entryId: entry.id,
          type: "makeup_skipped",
          eventId: entry.google_calendar_event_id,
          reason: muCheck.status === 404 || muCheck.status === 410
            ? "event_deleted"
            : `http_${muCheck.status}`,
        });
        continue;
      }

      const existingMu = await muCheck.json();
      const muOldStart = existingMu.start?.dateTime ?? existingMu.start?.date ?? "unknown";

      const muPatch = await fetch(
        `${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: `Make-Up Time – ${name}`,
            start: { dateTime: muStart, timeZone: companyTimezone },
            end:   { dateTime: muEnd,   timeZone: companyTimezone },
          }),
        }
      );

      if (muPatch.ok) {
        corrections.push({
          requestId: req.id,
          entryId: entry.id,
          type: "makeup_patched",
          eventId: entry.google_calendar_event_id,
          oldStart: muOldStart,
          newStart: muStart,
          timezone: companyTimezone,
        });
      } else {
        const err = await muPatch.text();
        corrections.push({
          requestId: req.id,
          entryId: entry.id,
          type: "makeup_patch_failed",
          eventId: entry.google_calendar_event_id,
          error: err,
        });
      }
    }
  }

  console.log(
    `[retroactive-fix] Complete. ${corrections.length} operations:`,
    JSON.stringify(corrections)
  );
  return corrections;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload: SyncPayload = await req.json();
    const { request_id, flexible_time_request_id, action } = payload;

    // Flexible time requests and retroactive fix are handled separately
    if (flexible_time_request_id || action === "retroactive_fix") {
      return await handleFlexibleTimeCalendar(
        supabase,
        flexible_time_request_id ?? null,
        action,
        corsHeaders
      );
    }

    if (!request_id) {
      return new Response(JSON.stringify({ error: "No request_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Shared settings ────────────────────────────────────────────────────────

    const { data: testModeSetting } = await supabase
      .from("app_settings").select("value").eq("key", "calendar_test_mode").single();
    const testMode = testModeSetting?.value === "true";

    const { data: calIdSetting } = await supabase
      .from("app_settings").select("value").eq("key", "google_calendar_id").single();
    const calendarId = calIdSetting?.value;
    if (!calendarId) {
      await logSync(supabase, request_id, "failed", null, "Google Calendar ID not configured");
      return new Response(
        JSON.stringify({ error: "Google Calendar ID not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: tzSetting } = await supabase
      .from("app_settings").select("value").eq("key", "company_timezone").single();
    const companyTimezone = tzSetting?.value || "America/New_York";

    console.log(`[calendar-sync] request=${request_id} action=${action} timezone=${companyTimezone}`);

    // Fetch request
    const { data: request } = await supabase
      .from("time_off_requests").select("*").eq("id", request_id).single();
    if (!request) throw new Error("Request not found");

    const { data: employee } = await supabase
      .from("profiles").select("full_name").eq("id", request.employee_id).single();

    const isHalfDayPm = request.start_day_portion === "pm";

    const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
      await logSync(supabase, request_id, "failed", null, "Google service account not configured");
      return new Response(
        JSON.stringify({ error: "Google service account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (testMode) {
      console.log(`[TEST MODE] Would ${action} calendar event for request ${request_id}`);
      await logSync(supabase, request_id, action as any, null, null, "test_mode");
      return new Response(
        JSON.stringify({ success: true, testMode: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
    const calendarApiBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;

    if (action === "create") {
      if (request.status !== "approved") {
        return new Response(
          JSON.stringify({ error: "Request is not approved" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const summary =
        request.request_type === "vacation"
          ? isHalfDayPm
            ? `${employee?.full_name} - Vacation - Half Day (Afternoon Off)`
            : `${employee?.full_name} - Vacation`
          : isHalfDayPm
            ? `${employee?.full_name} - Sick Day - Half Day (Afternoon Off)`
            : `${employee?.full_name} - Sick Day`;

      let startDate: string, endDate: string;
      if (request.request_type === "vacation") {
        startDate = normalizeDate(request.start_date!);
        endDate   = nextDay(request.end_date!);
      } else {
        startDate = normalizeDate(request.sick_date!);
        endDate   = nextDay(request.sick_date!);
      }

      const description = [
        request.note,
        isHalfDayPm ? "Half day – afternoon off (12:00 PM – 5:00 PM)" : null,
      ].filter(Boolean).join("\n") || undefined;

      // Half-day: timed event in company timezone. Full day: all-day event (date only).
      const event = isHalfDayPm
        ? {
            summary,
            description,
            start: { dateTime: `${startDate}T12:00:00`, timeZone: companyTimezone },
            end:   { dateTime: `${startDate}T17:00:00`, timeZone: companyTimezone },
          }
        : {
            summary,
            description,
            start: { date: startDate },
            end:   { date: endDate },
          };

      const res = await fetch(`${calendarApiBase}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      const eventData = await res.json();

      if (!res.ok) {
        await logSync(supabase, request_id, "failed", null, JSON.stringify(eventData));
        throw new Error(`Calendar API error: ${JSON.stringify(eventData)}`);
      }

      await supabase
        .from("time_off_requests")
        .update({ google_calendar_event_id: eventData.id })
        .eq("id", request_id);

      await logSync(supabase, request_id, "create", eventData.id);

      return new Response(
        JSON.stringify({ success: true, eventId: eventData.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "delete") {
      const eventId = request.google_calendar_event_id;
      if (!eventId) {
        await logSync(supabase, request_id, "delete", null, "No calendar event to delete");
        return new Response(
          JSON.stringify({ success: true, message: "No event to delete" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(
        `${calendarApiBase}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!res.ok && res.status !== 410) {
        const errData = await res.text();
        await logSync(supabase, request_id, "failed", eventId, errData);
        throw new Error(`Calendar delete error: ${errData}`);
      }

      await supabase
        .from("time_off_requests")
        .update({ google_calendar_event_id: null })
        .eq("id", request_id);

      await logSync(supabase, request_id, "delete", eventId);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Calendar sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logSync(
  supabase: any,
  requestId: string,
  actionType: string,
  eventId: string | null,
  errorMessage?: string | null,
  status?: string
) {
  await supabase.from("calendar_sync_logs").insert({
    request_id: requestId,
    action_type: actionType,
    google_calendar_event_id: eventId,
    error_message: errorMessage || null,
    status: status || (errorMessage ? "error" : "success"),
  });
}

async function handleFlexibleTimeCalendar(
  supabase: any,
  flexRequestId: string | null,
  action: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { data: testModeSetting } = await supabase
      .from("app_settings").select("value").eq("key", "calendar_test_mode").single();
    const testMode = testModeSetting?.value === "true";

    const { data: calIdSetting } = await supabase
      .from("app_settings").select("value").eq("key", "google_calendar_id").single();
    const calendarId = calIdSetting?.value;
    if (!calendarId) {
      return new Response(JSON.stringify({ error: "Google Calendar ID not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tzSetting } = await supabase
      .from("app_settings").select("value").eq("key", "company_timezone").single();
    const companyTimezone = tzSetting?.value || "America/New_York";

    console.log(`[flex-calendar] action=${action} id=${flexRequestId} timezone=${companyTimezone}`);

    const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
      return new Response(JSON.stringify({ error: "Google service account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (testMode) {
      console.log(`[TEST MODE] Flex calendar ${action} for ${flexRequestId}`);
      return new Response(JSON.stringify({ success: true, testMode: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
    const calendarApiBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;

    // Auto-run retroactive fix once after deployment if the flag is set
    if (action !== "retroactive_fix") {
      const { data: fixFlag } = await supabase
        .from("app_settings").select("value").eq("key", "retroactive_calendar_fix_needed").single();

      if (fixFlag?.value === "true") {
        console.log("[retroactive-fix] Auto-running...");
        await runRetroactiveFix(supabase, calendarApiBase, accessToken, companyTimezone);
        await supabase
          .from("app_settings")
          .upsert({ key: "retroactive_calendar_fix_needed", value: "false" });
      }
    }

    if (action === "retroactive_fix") {
      const corrections = await runRetroactiveFix(supabase, calendarApiBase, accessToken, companyTimezone);
      await supabase
        .from("app_settings")
        .upsert({ key: "retroactive_calendar_fix_needed", value: "false" });
      return new Response(
        JSON.stringify({ success: true, corrections }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!flexRequestId) {
      return new Response(JSON.stringify({ error: "No flexible_time_request_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: flexReq } = await supabase
      .from("flexible_time_requests").select("*").eq("id", flexRequestId).single();
    if (!flexReq) throw new Error("Flexible time request not found");

    const { data: employee } = await supabase
      .from("profiles").select("full_name").eq("id", flexReq.employee_id).single();
    const name = employee?.full_name || "Unknown";

    if (action === "create") {
      // Use plain local-time strings — Google Calendar interprets them using the
      // timeZone field below. Never append Z or apply UTC conversion.
      const offDateStr = normalizeDate(flexReq.date_off);
      const offStartTime = normalizeTime(flexReq.start_time);
      const offEndTime   = normalizeTime(flexReq.end_time);

      console.log(`[flex-calendar] Creating time-off event: ${offDateStr}T${offStartTime} – ${offEndTime} (${companyTimezone})`);

      const offEvent = {
        summary: `Flexible Time Off – ${name}`,
        description: flexReq.makeup_plan || undefined,
        start: { dateTime: `${offDateStr}T${offStartTime}`, timeZone: companyTimezone },
        end:   { dateTime: `${offDateStr}T${offEndTime}`,   timeZone: companyTimezone },
      };

      const offRes = await fetch(`${calendarApiBase}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(offEvent),
      });
      const offData = await offRes.json();
      if (offRes.ok) {
        await supabase.from("flexible_time_requests")
          .update({ google_calendar_event_id: offData.id }).eq("id", flexRequestId);
        console.log(`[flex-calendar] Time-off event created: ${offData.id}`);
      } else {
        console.error(`[flex-calendar] Time-off event creation failed:`, JSON.stringify(offData));
      }

      // Create make-up events
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*").eq("request_id", flexRequestId);

      for (const entry of entries || []) {
        const muDateStr   = normalizeDate(entry.makeup_date);
        const muStartTime = normalizeTime(entry.start_time);
        const muEndTime   = normalizeTime(entry.end_time);

        console.log(`[flex-calendar] Creating make-up event: ${muDateStr}T${muStartTime} – ${muEndTime} (${companyTimezone})`);

        const muEvent = {
          summary: `Make-Up Time – ${name}`,
          start: { dateTime: `${muDateStr}T${muStartTime}`, timeZone: companyTimezone },
          end:   { dateTime: `${muDateStr}T${muEndTime}`,   timeZone: companyTimezone },
        };
        const muRes = await fetch(`${calendarApiBase}/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(muEvent),
        });
        const muData = await muRes.json();
        if (muRes.ok) {
          await supabase.from("flexible_time_makeup_entries")
            .update({ google_calendar_event_id: muData.id }).eq("id", entry.id);
          console.log(`[flex-calendar] Make-up event created: ${muData.id}`);
        } else {
          console.error(`[flex-calendar] Make-up event creation failed:`, JSON.stringify(muData));
        }
      }

      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      if (flexReq.google_calendar_event_id) {
        await fetch(
          `${calendarApiBase}/events/${encodeURIComponent(flexReq.google_calendar_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
        await supabase.from("flexible_time_requests")
          .update({ google_calendar_event_id: null }).eq("id", flexRequestId);
      }

      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*").eq("request_id", flexRequestId);
      for (const entry of entries || []) {
        if (entry.google_calendar_event_id) {
          await fetch(
            `${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
          );
          await supabase.from("flexible_time_makeup_entries")
            .update({ google_calendar_event_id: null }).eq("id", entry.id);
        }
      }
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_incomplete") {
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*")
        .eq("request_id", flexRequestId).eq("completed", false);
      for (const entry of entries || []) {
        if (entry.google_calendar_event_id) {
          await fetch(
            `${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ summary: `Incomplete Make-Up Time – ${name}` }),
            }
          );
        }
      }
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Flex calendar sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
