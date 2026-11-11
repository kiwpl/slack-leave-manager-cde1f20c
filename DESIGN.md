# DESIGN.md

Frozen UI decisions. Do not change anything listed here unless Phil asks.

## 2026-11-10 · Morning off (mockup round 1 approved)
- Request forms keep "Half day on first day (afternoon off)" and add "Half day on last day (morning off)" right under it, same checkbox style.
- On a one-day request, ticking one half-day box unticks the other.
- One-day summary: "You will take the morning off on <date>." Sick day: "You were sick in the morning on <date>."
- Multi-day summary adds "(morning only)" after the end date and ends "You return on <end date> (afternoon)."
- A morning off counts as half a day.
- Request lists show "Morning off · <date>" for vacation and "Morning · <date>" for a sick day; multi-day shows "<end date> (morning)".

## 2026-11-11 · Six feature ideas (mockup round 3 approved)
- Requests stay Vacation and Sick Day only. No extra leave types.
- Request page (managers): "Who else is off" card under Request Details, titled with the people icon and "Approved and pending vacation from <start> to <end>".
- Who else is off: one row per weekday on phones (day, initials, "N off"); 4 boxes side by side on wider screens. Initials sit in circles without overlapping: blue = approved, amber = pending.
- Who else is off: under the days, an Approved / Pending legend, one row per other person (initials, name, "Vacation · <start> → <end>", status badge), then "Busiest: N of M people off on <days>" plus "if you approve this one" while pending.
- Slack approval message adds "Also off those days:" with one bullet per person ("<name>: Vacation, approved|pending (<start> → <end>)") and an italic "Busiest" line, above the Approve / Reject buttons.
- Ontario stat holidays are not counted as vacation days, and the return date skips them.
- Request summary adds a grey line: "Not counted as days off: <holiday (date)>…" and/or "Your return date skips <holiday (date)>…". Observed holidays read "Boxing Day (observed, Dec 28)".
- Time Off page: "Your time off in <year>" card under the page title: Vacation "<N> days this year" with a Used / Booked / Waiting for approval legend, then two boxes (Sick days, Flexible time) with a big number and a small label under it.
- No yearly vacation limit for now (Phil, 2026-11-11: Kelvin or Wilfred decide), so no "days left", no bar and no carry-over.
- Request form (vacation): under the summary, "With this request, your vacation in <year> comes to N days."
- Daily "Out today" message: replaced by round 4 below (app chat, no channel).
- Admin Settings: new "Team limits" card: "Most people off at once" number, Blocked dates list (dates, reason, Remove), From / To / Reason / Add row, "When a request hits a blocked date or the limit" with "Warn them, manager decides" or "Don't let them submit", Save.
- Request form (vacation): team limits box under the summary, yellow when warning and red when blocking, one line per problem with space between lines, ending "You can still submit, but your manager may decline it." or "Pick other dates to submit."
- Manager View: "Export CSV" outline button with a download icon, left of "Submit for Staff".
- Export pop-up "Export time off": Period (this pay period, last pay period, this month, this year, custom dates), Include (Vacation, Sick days, Flexible time), "Only approved requests", a preview table with a Total row and the file name, Cancel and Download CSV.
- Export pop-up on phones fits the screen; columns read Vacation / Sick / Flex hrs (Vacation days / Sick days / Flexible hours on wider screens).

## 2026-11-11 · Phone layout on every page (approved)
- Phone menu under the header is a 3-across grid, icon above the label, so every page shows in at most 2 rows. Desktop sidebar unchanged.
- Request page on phones: title on its own line, status badges on the row below; Request Details is one column (only wider screens use 2).
- List rows (My Requests, Manager View): badges wrap onto their own line, the submitted date stays top right inside the row.
- Audit Log on phones: each entry stacks (action, actor, details, then time); search and filter are full width.
- Pop-ups keep a 16px margin from the screen edge, rounded corners, scroll when taller than the screen, and stacked buttons have space between them.
- Text boxes use 16px text on phones (14px on desktop) so iPhones don't zoom in.
- Small buttons (User Management, flexible time "remove entry") are at least 36px tall on phones.

## 2026-11-11 · Out today in the app chat (mockup round 4 approved)
- The weekday "Out today · <weekday, month day>" message goes to managers and admins as a direct message in their Time Off Manager app chat. No Slack channel.
- Message: one bullet per person, then "Later this week" (when ticked), then "Sent to managers and admins every weekday at <time> · approved time off only".
- No message at all on a day when nobody is off (and none on weekends or stat holidays).
- Admin Settings card 'Daily "Out today" post': description "Send who's away to managers and admins in their Time Off Manager app chat every weekday morning"; "Post every weekday" switch on the right with "Monday to Friday, skips stat holidays and days when nobody is off"; Time (7:00 to 9:00 AM); "Also list time off later this week"; Save; Send a test post; then "The test goes only to you, in your Time Off Manager app chat."
- No Channel box and no /invite note.
