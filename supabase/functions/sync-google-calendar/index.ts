// v4 – bulletproof UTC conversion via Intl.DateTimeFormat for Flexible Time calendar events
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
// PostgreSQL `time without time zone` should come back as "HH:MM:SS", but
// in some environments it may include "+00" or ".000000". An embedded offset
// would override the timeZone field in the Google Calendar API, causing events
// to land in UTC instead of the company's local timezone.
function normalizeTime(t: string): string {
  const m = (t || "").match(/^(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : t;
}

// Ensure date strings are always "YYYY-MM-DD" (10 chars).
function normalizeDate(d: string): string {
  return (d || "").substring(0, 10);
}

/**
 * Convert a local date+time in the given timezone to an explicit UTC ISO string
 * (ending in "Z"). This is the bulletproof way to tell Google Calendar exactly
 * when an event occurs: the UTC instant is unambiguous regardless of any
 * `timeZone` field behaviour.
 *
 * Algorithm:
 *  1. Treat the local time as UTC to get a rough candidate timestamp.
 *  2. Ask Intl.DateTimeFormat what local time that UTC instant corresponds to.
 *  3. Compute the gap between that local reading and the desired local time.
 *  4. Subtract the gap from the candidate to get the real UTC instant.
 */
function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":").map(Number);
  const hour = timeParts[0], minute = timeParts[1], second = timeParts[2] || 0;

  // Rough candidate: pretend local time is UTC
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // What does the candidate UTC instant look like in the target timezone?
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(candidate);
  const localHour = parseInt(parts.find((p) => p.type === "hour")!.value) % 24; // "24" → 0 at midnight
  const localMin  = parseInt(parts.find((p) => p.type === "minute")!.value);
  const localSec  = parseInt(parts.find((p) => p.type === "second")!.value);

  // Offset in seconds: how far the candidate's local reading is from the desired time
  let offsetSec = (localHour * 3600 + localMin * 60 + localSec)
                - (hour       * 3600 + minute  * 60 + second);

  // Correct for midnight crossings (timezone offsets are at most ±14 h)
  if (offsetSec >  43200) offsetSec -= 86400;
  if (offsetSec < -43200) offsetSec += 86400;

  // Shift the candidate back/forward to land on the real UTC instant
  const actualUtc = new Date(candidate.getTime() - offsetSec * 1000);
  return actualUtc.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);

  // Create JWT
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

  // Import private key
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

  // Exchange for access token
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

// Retroactive fix: patch all Flexible Time Request calendar events whose
// times were stored with incorrect UTC offsets. Reads correct times from
// the database and updates Google Calendar to match.
async function runRetroactiveFix(
  supabase: any,
  calendarApiBase: string,
  accessToken: string,
  companyTimezone: string
): Promise<unknown[]> {
  const corrections: unknown[] = [];

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

    const correctStart = localTimeToUTC(normalizeDate(req.date_off), normalizeTime(req.start_time), companyTimezone);
    const correctEnd   = localTimeToUTC(normalizeDate(req.date_off), normalizeTime(req.end_time),   companyTimezone);

    // Check whether the main time-off event still exists in Google Calendar
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
            end: { dateTime: correctEnd, timeZone: companyTimezone },
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
      const muStart = localTimeToUTC(normalizeDate(entry.makeup_date), normalizeTime(entry.start_time), companyTimezone);
      const muEnd   = localTimeToUTC(normalizeDate(entry.makeup_date), normalizeTime(entry.end_time),   companyTimezone);

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
            end: { dateTime: muEnd, timeZone: companyTimezone },
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
    `[retroactive-calendar-fix] Complete. ${corrections.length} operations logged:`,
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

    // Handle flexible time requests separately
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

    // Check test mode
    const { data: testModeSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "calendar_test_mode")
      .single();
    const testMode = testModeSetting?.value === "true";

    // Get calendar ID
    const { data: calIdSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "google_calendar_id")
      .single();

    const calendarId = calIdSetting?.value;
    if (!calendarId) {
      await logSync(supabase, request_id, "failed", null, "Google Calendar ID not configured");
      return new Response(
        JSON.stringify({ error: "Google Calendar ID not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch request
    const { data: request } = await supabase
      .from("time_off_requests")
      .select("*")
      .eq("id", request_id)
      .single();

    if (!request) {
      throw new Error("Request not found");
    }

    // Get employee name
    const { data: employee } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", request.employee_id)
      .single();

    // Declared at outer scope to avoid TS scope errors
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
      // Only create for approved requests
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
        startDate = request.start_date!;
        // Google Calendar all-day events use exclusive end date
        const end = new Date(request.end_date!);
        end.setDate(end.getDate() + 1);
        endDate = end.toISOString().split("T")[0];
      } else {
        startDate = request.sick_date!;
        const end = new Date(request.sick_date!);
        end.setDate(end.getDate() + 1);
        endDate = end.toISOString().split("T")[0];
      }

      const description = [
        request.note,
        isHalfDayPm ? "Half day – afternoon off (12:00 PM – 5:00 PM)" : null,
      ].filter(Boolean).join("\n") || undefined;

      const event = isHalfDayPm
        ? {
            summary,
            description,
            start: { dateTime: `${startDate}T12:00:00`, timeZone: "America/New_York" },
            end: { dateTime: `${startDate}T17:00:00`, timeZone: "America/New_York" },
          }
        : {
            summary,
            description,
            start: { date: startDate },
            end: { date: endDate },
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

      // Store event ID on request
      await supabase
        .from("time_off_requests")
        .update({ google_calendar_event_id: eventData.id })
        .eq("id", request_id);

      await logSync(supabase, request_id, "create", eventData.id);

      return new Response(
        JSON.stringify({ success: true, eventId: eventData.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (action === "delete") {
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
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!res.ok && res.status !== 410) {
        const errData = await res.text();
        await logSync(supabase, request_id, "failed", eventId, errData);
        throw new Error(`Calendar delete error: ${errData}`);
      }

      // Clear event ID
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

    // On the first invocation after deployment the migration sets this flag to
    // "true". We run the retroactive fix here (once) then clear the flag so
    // subsequent calls are not affected.
    if (action !== "retroactive_fix") {
      const { data: fixFlag } = await supabase
        .from("app_settings").select("value").eq("key", "retroactive_calendar_fix_needed").single();

      if (fixFlag?.value === "true") {
        console.log("[retroactive-calendar-fix] Auto-running retroactive fix...");
        await runRetroactiveFix(supabase, calendarApiBase, accessToken, companyTimezone);
        await supabase
          .from("app_settings")
          .upsert({ key: "retroactive_calendar_fix_needed", value: "false" });
      }
    }

    // Manual / explicit retroactive fix action
    if (action === "retroactive_fix") {
      const corrections = await runRetroactiveFix(supabase, calendarApiBase, accessToken, companyTimezone);
      // Clear the flag in case it was still pending
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
      // Build UTC dateTime strings so the event lands at the correct local time
      // regardless of how Google Calendar or the DB handles the timeZone field.
      const offDateStr = normalizeDate(flexReq.date_off);
      const offEvent = {
        summary: `Flexible Time Off – ${name}`,
        description: flexReq.makeup_plan || undefined,
        start: {
          dateTime: localTimeToUTC(offDateStr, normalizeTime(flexReq.start_time), companyTimezone),
          timeZone: companyTimezone,
        },
        end: {
          dateTime: localTimeToUTC(offDateStr, normalizeTime(flexReq.end_time), companyTimezone),
          timeZone: companyTimezone,
        },
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
      }

      // Create make-up events
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*").eq("request_id", flexRequestId);
      for (const entry of entries || []) {
        const muDateStr = normalizeDate(entry.makeup_date);
        const muEvent = {
          summary: `Make-Up Time – ${name}`,
          start: {
            dateTime: localTimeToUTC(muDateStr, normalizeTime(entry.start_time), companyTimezone),
            timeZone: companyTimezone,
          },
          end: {
            dateTime: localTimeToUTC(muDateStr, normalizeTime(entry.end_time), companyTimezone),
            timeZone: companyTimezone,
          },
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
        }
      }

      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      // Delete main event
      if (flexReq.google_calendar_event_id) {
        await fetch(`${calendarApiBase}/events/${encodeURIComponent(flexReq.google_calendar_event_id)}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
        });
        await supabase.from("flexible_time_requests")
          .update({ google_calendar_event_id: null }).eq("id", flexRequestId);
      }
      // Delete make-up events
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*").eq("request_id", flexRequestId);
      for (const entry of entries || []) {
        if (entry.google_calendar_event_id) {
          await fetch(`${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
          });
          await supabase.from("flexible_time_makeup_entries")
            .update({ google_calendar_event_id: null }).eq("id", entry.id);
        }
      }
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_incomplete") {
      // Update make-up event titles to "Incomplete"
      const { data: entries } = await supabase
        .from("flexible_time_makeup_entries").select("*").eq("request_id", flexRequestId).eq("completed", false);
      for (const entry of entries || []) {
        if (entry.google_calendar_event_id) {
          await fetch(`${calendarApiBase}/events/${encodeURIComponent(entry.google_calendar_event_id)}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ summary: `Incomplete Make-Up Time – ${name}` }),
          });
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}
