import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SyncPayload {
  request_id: string;
  action: "create" | "delete";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload: SyncPayload = await req.json();
    const { request_id, action } = payload;

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
          ? `${employee?.full_name} - Vacation`
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

      const event = {
        summary,
        description: request.note || undefined,
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
