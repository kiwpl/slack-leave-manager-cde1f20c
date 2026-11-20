// v4 – one "Off this week" message on the first working day of the week (with
//      return dates and working days until back), plus a short "New this week"
//      message only on a day someone not yet listed that week is off.
// v3 – drop the "Sent to managers and admins every weekday at …" footer line.
// v2 – send the "Out today" message to managers and admins in their Time Off
//      Manager app chat (no channel), and send nothing on a day nobody is off.
// v1 – weekday "Out today" post in a Slack channel.
//
// Called two ways:
//  1. By pg_cron every 15 minutes on weekday mornings (body {}). Once a day,
//     after the time set in Admin Settings:
//       - On the first working day of the week (Monday, or Tuesday when Monday
//         is a stat holiday) it sends "Off this week": everyone off any day
//         from today to Friday.
//       - On the other days it sends "New this week" only if someone is off
//         today who wasn't in this week's messages yet. Otherwise nothing.
//     Messages go to every active manager and admin with a Slack ID, as a
//     direct message from the app. Nothing is sent when nobody is off. Never
//     runs on a weekend or Ontario stat holiday.
//  2. By an admin pressing "Send a test post" in Admin Settings (body
//     { test: true } with the admin's sign-in token). That sends the weekly
//     message as it would look now, to that admin only.
//
// Settings live in app_settings:
//   out_today_enabled      "true" | "false" (off until an admin turns it on)
//   out_today_time         "08:00" (Toronto time, 24h)
//   out_today_last_posted  "YYYY-MM-DD" (written by this function: today is done)
//   out_today_week         JSON {"week":"<Monday>","sent":["t:<id>","f:<id>",…]}
//                          (written by this function: who this week's messages
//                          already listed, so nobody is repeated mid-week)
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
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "superadmin"]);
      if (!roles || roles.length === 0) return json({ ok: false, error: "Only admins can send a test post." }, 403);
      const { data: me } = await supabase.from("profiles").select("slack_user_id").eq("id", userId).maybeSingle();
      if (!me?.slack_user_id) {
        return json({
          ok: false,
          error: "Your profile has no Slack ID yet. Add it in User Management, then try again.",
        });
      }
      testSlackId = me.slack_user_id;
    }

    const { data: settingRows } = await supabase.from("app_settings").select("key, value");
    const s = new Map<string, string>((settingRows ?? []).map((r: any) => [r.key, r.value]));
    // Off until an admin switches it on in Admin Settings.
    const enabled = s.get("out_today_enabled") === "true";
    const postTime = s.get("out_today_time") || "08:00";
    const testMode = s.get("slack_test_mode") === "true";

    const now = torontoNow();

    if (!isTest) {
      if (!enabled) return json({ ok: true, skipped: "turned off" });
      if (now.weekday === 0 || now.weekday === 6) return json({ ok: true, skipped: "weekend" });
      if (ontarioHolidayDates(now.year).has(now.date)) return json({ ok: true, skipped: "stat holiday" });
      if (now.time < postTime) return json({ ok: true, skipped: "too early" });
      if (s.get("out_today_last_posted") === now.date) return json({ ok: true, skipped: "already done today" });
    }

    // The week the message is about. A test on a weekend shows next week's message.
    const from =
      isTest && (now.weekday === 0 || now.weekday === 6) ? addDaysIso(now.date, now.weekday === 0 ? 1 : 2) : now.date;
    const fromWeekday = new Date(`${from}T12:00:00Z`).getUTCDay();
    const monday = addDaysIso(from, 1 - fromWeekday);
    const friday = addDaysIso(from, 5 - fromWeekday);

    // Who this week's messages already listed. A new week starts empty, and the
    // first working day of a new week gets the full "Off this week" message.
    let state: { week: string; sent: string[] } = { week: "", sent: [] };
    try {
      const saved = JSON.parse(s.get("out_today_week") || "{}");
      if (saved && typeof saved.week === "string" && Array.isArray(saved.sent)) state = saved;
    } catch {
      // Unreadable value: treat it as a new week.
    }
    const weekly = isTest || state.week !== monday;
    if (weekly && !isTest) state = { week: monday, sent: [] };

    const all = await loadTimeOff(supabase, from, friday);
    const announced = new Set(state.sent);
    const picked = weekly ? all : all.filter((o) => !announced.has(o.key) && o.start <= from && o.end >= from);

    // Today is decided once, and what was listed is remembered for the rest of the week.
    const markDone = async () => {
      const at = new Date().toISOString();
      const sent = [...new Set([...state.sent, ...picked.map((o) => o.key)])];
      await supabase.from("app_settings").upsert(
        [
          { key: "out_today_last_posted", value: now.date, updated_at: at },
          { key: "out_today_week", value: JSON.stringify({ week: monday, sent }), updated_at: at },
        ],
        { onConflict: "key" },
      );
    };

    if (!isTest && picked.length === 0) {
      await markDone();
      return json({ ok: true, skipped: weekly ? "nobody off this week" : "nobody new off today" });
    }

    const names = await loadNames(
      supabase,
      picked.map((o) => o.employeeId),
    );
    const text = buildText(picked, names, { weekly, from, monday, friday, isTest });

    // Who gets it: the admin testing, or every active manager and admin with a Slack ID.
    let recipients: string[] = [];
    if (isTest) {
      recipients = [testSlackId];
    } else {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").in("role", MANAGER_ROLES);
      const ids = [...new Set((roleRows ?? []).map((r: any) => r.user_id))];
      if (ids.length) {
        const { data: people } = await supabase
          .from("profiles")
          .select("slack_user_id")
          .in("id", ids)
          .eq("status", "active");
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

// ── Who is off ──────────────────────────────────────────────────────

interface Off {
  key: string; // "t:<request id>" or "f:<flexible time id>"
  employeeId: string;
  type: "vacation" | "sick" | "flex";
  start: string;
  end: string;
  sp: string; // first day: "pm" = afternoon off
  ep: string; // last day: "am" = morning off
  startTime?: string;
  endTime?: string;
}

/** Approved time off and flexible time on any day from `from` to `friday`. */
async function loadTimeOff(supabase: any, from: string, friday: string): Promise<Off[]> {
  const { data: timeOff } = await supabase
    .from("time_off_requests")
    .select("id, employee_id, request_type, start_date, end_date, sick_date, start_day_portion, end_day_portion")
    .in("status", ["approved", "cancel_requested"])
    .lte("start_date", friday)
    .gte("end_date", from);

  const { data: flex } = await supabase
    .from("flexible_time_requests")
    .select("id, employee_id, date_off, start_time, end_time")
    .in("status", ["approved", "completed", "incomplete"])
    .gte("date_off", from)
    .lte("date_off", friday);

  const out: Off[] = [];
  for (const r of timeOff ?? []) {
    const start = r.start_date || r.sick_date;
    const end = r.end_date || start;
    if (!start || !end) continue;
    out.push({
      key: `t:${r.id}`,
      employeeId: r.employee_id,
      type: r.request_type === "sick" ? "sick" : "vacation",
      start,
      end,
      sp: r.start_day_portion,
      ep: r.end_day_portion,
    });
  }
  for (const f of flex ?? []) {
    out.push({
      key: `f:${f.id}`,
      employeeId: f.employee_id,
      type: "flex",
      start: f.date_off,
      end: f.date_off,
      sp: "full",
      ep: "full",
      startTime: f.start_time,
      endTime: f.end_time,
    });
  }
  return out;
}

async function loadNames(supabase: any, employeeIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(employeeIds)];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names.set(p.id, p.full_name || p.email || "Someone");
  }
  return names;
}

// ── Building the message ────────────────────────────────────────────

function buildText(
  picked: Off[],
  names: Map<string, string>,
  o: { weekly: boolean; from: string; monday: string; friday: string; isTest: boolean },
): string {
  const rows = picked.map((x) => {
    const name = names.get(x.employeeId) || "Someone";
    const first = x.start > o.from ? x.start : o.from;
    return { name, first, line: `• ${name}: ${describe(x, o.from, o.monday, o.friday)}` };
  });
  rows.sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
  // The same request saved twice shows once.
  const lines = [...new Set(rows.map((r) => r.line))];

  let text = o.weekly
    ? `*Off this week · ${o.from === o.friday ? longDay(o.from) : `${longDay(o.from)} – ${longDay(o.friday)}`}*\n`
    : `*New this week · ${longDay(o.from)}*\n`;
  text += lines.length ? lines.join("\n") : "No one is off this week. In a week like this, no message is sent.";
  // No footer line on the real message; a test is marked so it can be told apart.
  if (o.isTest) text += `\n\n_Test_`;
  return text;
}

/**
 * "Vacation until Friday, November 20 · back Monday, November 23 (in 10 working days)"
 * "Vacation, Friday afternoon · back Monday, November 16"
 * "Sick day, this morning"
 * "Flexible time, Wednesday 1:00 – 3:00 PM"
 */
function describe(x: Off, from: string, monday: string, friday: string): string {
  // "today" / "this morning" on the day the message goes out, the weekday name
  // for the rest of this week, the full date after this week.
  const label = (iso: string, part: "" | "am" | "pm") => {
    if (iso === from) return part === "am" ? "this morning" : part === "pm" ? "this afternoon" : "today";
    const base = iso <= friday ? WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()] : longDay(iso);
    return part === "am" ? `${base} morning` : part === "pm" ? `${base} afternoon` : base;
  };

  if (x.type === "flex") {
    // "1:00 – 3:00 PM", or "11:00 AM – 1:00 PM" when it crosses noon.
    const a = clock(x.startTime!),
      b = clock(x.endTime!);
    const range = a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
    return `Flexible time, ${label(x.start, "")} ${range}`;
  }

  const startPart = x.sp === "pm" ? "pm" : "";
  const endPart = x.ep === "am" ? "am" : "";
  // Already away when the message goes out (not just from this afternoon).
  const away = x.start < from || (x.start === from && !startPart);

  let days: string;
  if (x.start === x.end) days = `, ${label(x.start, startPart || endPart)}`;
  else if (away && x.start <= monday && x.end === friday && !endPart) days = " all week";
  else if (away) days = ` until ${label(x.end, endPart)}`;
  else days = ` from ${label(x.start, startPart)} until ${label(x.end, endPart)}`;

  if (x.type === "sick") return `${x.start === x.end ? "Sick day" : "Sick days"}${days}`;

  // Back the afternoon of the last day when that morning is off; otherwise the
  // next working day.
  const back = endPart ? x.end : returnDay(x.end);
  let text = `Vacation${days} · back ${endPart ? (x.end === from ? "this afternoon" : `${longDay(x.end)} afternoon`) : longDay(back)}`;
  if (away && back > from) {
    const n = workingDaysBetween(from, back);
    if (n > 0) text += ` (in ${n} working day${n === 1 ? "" : "s"})`;
  }
  return text;
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
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date,
    time: `${hour}:${get("minute")}`,
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
    year: Number(get("year")),
  };
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday to Friday and not an Ontario stat holiday. */
function isWorkingDay(iso: string): boolean {
  const w = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6 && !ontarioHolidayDates(Number(iso.slice(0, 4))).has(iso);
}

/** First working day after the last day off (skips weekends and stat holidays). */
function returnDay(end: string): string {
  let d = addDaysIso(end, 1);
  while (!isWorkingDay(d)) d = addDaysIso(d, 1);
  return d;
}

/** Working days from `from` (counted) up to `to` (not counted). */
function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d < to; d = addDaysIso(d, 1)) if (isWorkingDay(d)) n++;
  return n;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100;
  const dd = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = utc(Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  const goodFriday = new Date(easter.getTime() - 2 * 86400000);
  const victoria = utc(4, 24);
  while (victoria.getUTCDay() !== 1) victoria.setUTCDate(victoria.getUTCDate() - 1);
  const actual = [
    utc(0, 1),
    nthMonday(1, 3),
    goodFriday,
    victoria,
    utc(6, 1),
    nthMonday(8, 1),
    nthMonday(9, 2),
    utc(11, 25),
    utc(11, 26),
  ];
  const isWknd = (x: Date) => x.getUTCDay() === 0 || x.getUTCDay() === 6;
  const key = (x: Date) => x.toISOString().slice(0, 10);
  const taken = new Set<string>();
  for (const x of actual) if (!isWknd(x)) taken.add(key(x));
  for (const x of actual) {
    if (!isWknd(x)) continue;
    const y = new Date(x.getTime());
    do {
      y.setUTCDate(y.getUTCDate() + 1);
    } while (isWknd(y) || taken.has(key(y)));
    taken.add(key(y));
  }
  holidayCache.set(year, taken);
  return taken;
}
