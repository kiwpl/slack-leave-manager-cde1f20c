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
- Slack: weekday "Out today · <weekday, month day>" post in a channel, one bullet per person, then "Later this week", then "Posted every weekday at <time> · approved time off only".
- Admin Settings: new card 'Daily "Out today" post' after Slack Integration: "Post every weekday" switch, Channel, Time (7:00 to 9:00 AM), "Also list time off later this week" checkbox, Save, Send a test post.
- Admin Settings: new "Team limits" card: "Most people off at once" number, Blocked dates list (dates, reason, Remove), From / To / Reason / Add row, "When a request hits a blocked date or the limit" with "Warn them, manager decides" or "Don't let them submit", Save.
- Request form (vacation): team limits box under the summary, yellow when warning and red when blocking, one line per problem with space between lines, ending "You can still submit, but your manager may decline it." or "Pick other dates to submit."
- Manager View: "Export CSV" outline button with a download icon, left of "Submit for Staff".
- Export pop-up "Export time off": Period (this pay period, last pay period, this month, this year, custom dates), Include (Vacation, Sick days, Flexible time), "Only approved requests", a preview table with a Total row and the file name, Cancel and Download CSV.
- Export pop-up on phones fits the screen; columns read Vacation / Sick / Flex hrs (Vacation days / Sick days / Flexible hours on wider screens).
