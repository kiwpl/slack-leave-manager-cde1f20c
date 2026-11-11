// v2 – send the "Out today" message to managers and admins in their Time Off
//      Manager app chat (no channel), and send nothing on a day nobody is off.
// v1 – weekday "Out today" post in a Slack channel.
//
// Called two ways:
//  1. By pg_cron every 15 minutes on weekday mornings (body {}). Once a day,
//     after the time set in Admin Settings, it looks at who is off today. If
//     anyone is, every manager and admin with a Slack ID gets the message as a
//     direct message from the app. If nobody is, nothing is sent. Never runs
//     on a weekend or Ontario stat holiday.
//  2. By an admin pressing "Send a test post" in Admin Settings (body
//     { test: true } with the admin's sign-in token). That sends the message
//     right away, to that admin only.
//
// Settings live in app_settings:
//   out_today_enabled  "true" | "false" (off until an admin turns it on)
//   out_today_time     "08:00" (Toronto time, 24h)
//   out_today_later    "true" | "false" (also list time off later this week)
//   out_today_last_posted  "YYYY-MM-DD" (written by this function: today is done)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "America/Toronto";
const MANAGER_ROLES = ["manager", "admin", "superadmin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) return json({ ok: false, error: "SLACK_BOT_TOKEN not configured" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const isTest = body?.test === true;

    // A test goes only to the signed-in admin who asked for it.
    let testSlackId = "";
    if (isTest) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: userData } = await supabase.auth.getUser(token);
      const userId = userData?.user?.id;
      if (!userId) return json({ ok: false, error: "Please sign in again." }, 401);
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "superadmin"]);
      if (!roles || roles.length === 0) return json({ ok: false, error: "Only admins can send a test post." }, 403);
      const { data: me } = await supabase.from("profiles").select("slack_user_id").eq("id", userId).maybeSingle();
      if (!me?.slack_user_id) {
        return json({ ok: false, error: "Your profile has no Slack ID yet. Add it in User Management, then try again." });
      }
      testSlackId = me.slack_user_id;
    }

    const { data: settingRows } = await supabase.from("app_settings").select("key, value");
    const s = new Map<string, string>((settingRows ?? []).map((r: any) => [r.key, r.value]));
    // Off until an admin switches it on in Admin Settings.
    const enabled = s.get("out_today_enabled") === "true";
    const postTime = s.get("out_today_time") || "08:00";
    const includeLater = (s.get("out_today_later") ?? "true") === "true";
    const testMode = s.get("slack_test_mode") === "true";

    const now = torontoNow();

    if (!isTest) {
      if (!enabled) return json({ ok: true, skipped: "turned off" });
      if (now.weekday === 0 || now.weekday === 6) return json({ ok: true, skipped: "weekend" });
      if (ontarioHolidayDates(now.year).has(now.date)) return json({ ok: true, skipped: "stat holiday" });
      if (now.time < postTime) return json({ ok: true, skipped: "too early" });
      if (s.get("out_today_last_posted") === now.date) return json({ ok: true, skipped: "already done today" });
    }

    const { text, anyoneOff } = await buildPost(supabase, now, includeLater, postTime, isTest);

    // Today is decided once: nobody off means no message, and no second look later.
    const markDone = () =>
      supabase
        .from("app_settings")
        .upsert({ key: "out_today_last_posted", value: now.date, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (!isTest && !anyoneOff) {
      await markDone();
      return json({ ok: true, skipped: "nobody off today" });
    }

    // Who gets it: the admin testing, or every active manager and admin with a Slack ID.
    let recipients: string[] = [];
    if (isTest) {
      recipients = [testSlackId];
    } else {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").in("role", MANAGER_ROLES);
      const ids = [...new Set((roleRows ?? []).map((r: any) => r.user_id))];
      if (ids.length) {
        const { data: people } = await supabase
          .from("profiles").select("slack_user_id").in("id", ids).eq("status", "active");
        recipients = [...new Set((people ?? []).map((p: any) => p.slack_user_id).filter(Boolean))] as string[];
      }
    }
    if (recipients.length === 0) {
      if (!isTest) await markDone();
      return json({ ok: false, error: "No active manager or admin has a Slack ID." });
    }

    let sent = 0;
    const failed: { slackUserId: string; error: string }[] = [];
    for (const slackUserId of recipients) {
      if (testMode) {
        console.log(`[TEST MODE] Would send to ${slackUserId}:\n${text}`);
        sent++;
        continue;
      }
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: slackUserId, text, unfurl_links: false, unfurl_media: false }),
      });
      const data = await res.json();
      if (data.ok) {
        sent++;
      } else {
        console.error(`[out-today] Slack refused the message to ${slackUserId}:`, data.error);
        failed.push({ slackUserId, error: data.error });
      }
    }

    if (!isTest) await markDone();
    return json({ ok: sent > 0, sent, failed, testMode, error: sent > 0 ? undefined : failed[0]?.error });
  } catch (error) {
    console.error("[out-today] Failed:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// ── Building the message ────────────────────────────────────────────

async function buildPost(supabase: any, now: TorontoNow, includeLater: boolean, postTime: string, isTest: boolean) {
  const today = now.date;
  const friday = addDaysIso(today, 5 - now.weekday);

  const { data: timeOff } = await supabase
    .from("time_off_requests")
    .select("employee_id, request_type, start_date, end_date, sick_date, start_day_portion, end_day_portion")
    .in("status", ["approved", "cancel_requested"])
    .lte("start_date", friday)
    .gte("end_date", today);

  const { data: flex } = await supabase
    .from("flexible_time_requests")
    .select("employee_id, date_off, start_time, end_time")
    .in("status", ["approved", "completed", "incomplete"])
    .eq("date_off", today);

  const ids = [...new Set([...(timeOff ?? []).map((r: any) => r.employee_id), ...(flex ?? []).map((r: any) => r.employee_id)])];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names.set(p.id, p.full_name || p.email || "Someone");
  }
  const nameOf = (id: string) => names.get(id) || "Someone";

  const todayLines: { name: string; line: string }[] = [];
  const laterLines: { employeeId: string; name: string; start: string; line: string }[] = [];
  const offToday = new Set<string>();

  for (const r of timeOff ?? []) {
    const start = r.start_date || r.sick_date;
    const end = r.end_date || start;
    if (!start || !end) continue;
    const kind = r.request_type === "sick" ? "Sick day" : "Vacation";
    if (start <= today && end >= today) {
      let detail = "";
      if (start === today && end === today && r.start_day_portion === "pm") detail = "afternoon";
      else if (start === today && end === today && r.end_day_portion === "am") detail = "morning";
      else if (start === today && r.start_day_portion === "pm") detail = "from this afternoon";
      else if (end === today && r.end_day_portion === "am") detail = "morning, back this afternoon";
      if (!detail && r.request_type !== "sick") detail = `back ${longDay(returnDay(end))}`;
      todayLines.push({ name: nameOf(r.employee_id), line: `• ${nameOf(r.employee_id)}: ${kind}${detail ? `, ${detail}` : ""}` });
      offToday.add(r.employee_id);
    } else if (r.request_type === "vacation" && start > today && start <= friday) {
      const oneDay = start === end;
      const half = oneDay && r.start_day_portion === "pm" ? ", afternoon off" : oneDay && r.end_day_portion === "am" ? ", morning off" : "";
      laterLines.push({
        employeeId: r.employee_id,
        name: nameOf(r.employee_id),
        start,
        line: `• ${nameOf(r.employee_id)}: ${oneDay ? longDay(start) : `from ${longDay(start)}`}${half}`,
      });
    }
  }
  for (const f of flex ?? []) {
    todayLines.push({ name: nameOf(f.employee_id), line: `• ${nameOf(f.employee_id)}: Flexible time, ${clock(f.start_time)} – ${clock(f.end_time)}` });
  }

  todayLines.sort((a, b) => a.name.localeCompare(b.name));
  laterLines.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  // Someone already off today is not repeated under "Later this week".
  const later = laterLines.filter((l) => !offToday.has(l.employeeId));

  let text = `*Out today · ${longDay(today)}*\n`;
  text += todayLines.length
    ? todayLines.map((l) => l.line).join("\n")
    : "No one is off today. On a normal day like this, no message is sent.";
  if (includeLater && later.length) text += `\n\n*Later this week*\n${later.map((l) => l.line).join("\n")}`;
  text += `\n\n_${isTest ? "Test · " : ""}Sent to managers and admins every weekday at ${clock(postTime)} · approved time off only_`;
  return { text, anyoneOff: todayLines.length > 0 };
}

// ── Dates and times (Toronto) ───────────────────────────────────────

interface TorontoNow {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24h
  weekday: number; // 0 = Sunday
  year: number;
}

function torontoNow(): TorontoNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date, time: `${hour}:${get("minute")}`, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), year: Number(get("year")) };
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First working day after the last day off (skips weekends and stat holidays). */
function returnDay(end: string): string {
  let d = addDaysIso(end, 1);
  for (;;) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6 && !ontarioHolidayDates(Number(d.slice(0, 4))).has(d)) return d;
    d = addDaysIso(d, 1);
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-16" → "Monday, November 16" */
function longDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "13:00:00" → "1:00 PM" */
function clock(t: string): string {
  const [h, m] = (t || "0:0").split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

// Ontario stat holidays (observed dates). Mirrors src/lib/holidays.ts.
const holidayCache = new Map<number, Set<string>>();
function ontarioHolidayDates(year: number): Set<string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const utc = (m: number, d: number) => new Date(Date.UTC(year, m, d));
  const nthMonday = (m: number, n: number) => {
    const first = utc(m, 1);
    return utc(m, 1 + ((8 - first.getUTCDay()) % 7) + (n - 1) * 7);
  };
  // Easter Sunday (anonymous Gregorian algorithm)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = utc(Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  const goodFriday = new Date(easter.getTime() - 2 * 86400000);
  const victoria = utc(4, 24);
  while (victoria.getUTCDay() !== 1) victoria.setUTCDate(victoria.getUTCDate() - 1);
  const actual = [utc(0, 1), nthMonday(1, 3), goodFriday, victoria, utc(6, 1), nthMonday(8, 1), nthMonday(9, 2), utc(11, 25), utc(11, 26)];
  const isWknd = (x: Date) => x.getUTCDay() === 0 || x.getUTCDay() === 6;
  const key = (x: Date) => x.toISOString().slice(0, 10);
  const taken = new Set<string>();
  for (const x of actual) if (!isWknd(x)) taken.add(key(x));
  for (const x of actual) {
    if (!isWknd(x)) continue;
    const y = new Date(x.getTime());
    do { y.setUTCDate(y.getUTCDate() + 1); } while (isWknd(y) || taken.has(key(y)));
    taken.add(key(y));
  }
  holidayCache.set(year, taken);
  return taken;
}
