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
- Audit Log on phones: each entry stacks (what is in an entry is replaced by round 8 below: sentence, small line, then time); search and filter are full width.
- Pop-ups keep a 16px margin from the screen edge, rounded corners, scroll when taller than the screen, and stacked buttons have space between them.
- Text boxes use 16px text on phones (14px on desktop) so iPhones don't zoom in.
- Small buttons (User Management, flexible time "remove entry") are at least 36px tall on phones.

## 2026-11-11 · Out today in the app chat (mockup round 4 approved)
- Messages go to managers and admins as a direct message in their Time Off Manager app chat. No Slack channel.
- The daily "Out today" message, its "Later this week" part and the 'Daily "Out today" post' card: replaced by round 5 below (one weekly message).
- No footer line (Phil, 2026-11-19: the "Sent to managers and admins every weekday at <time> · approved time off only" line is removed). A test message ends with "Test".
- No Channel box and no /invite note.

## 2026-11-20 · Weekly "Off this week" message (mockup round 5 approved)
- One message on Monday morning: "Off this week · <Monday, month day> – <Friday, month day>". When Monday is a stat holiday it goes out Tuesday and covers Tuesday to Friday.
- One bullet per person off any day that week: their days off, then "back <weekday, month day>". Anyone already away when it goes out also gets "(in N working days)"; working days skip weekends and stat holidays. Example: "Maya Torres: Vacation until Friday, November 20 · back Monday, November 23 (in 10 working days)".
- Someone still off next week is listed again in next Monday's message.
- Mid-week: a short "New this week · <weekday, month day>" message only on a day someone not yet in that week's messages is off (e.g. "Sam Patel: Sick day, this morning"). Otherwise nothing until next Monday.
- No message in a week when nobody is off.
- Admin Settings card 'Weekly "Off this week" message': description "Send who's off this week to managers and admins in their Time Off Manager app chat on Monday morning, with a short update when someone new is off"; "Weekly message on Mondays" switch on the right with "Goes out Tuesday when Monday is a stat holiday. Nothing is sent in a week when nobody is off."; Time (7:00 to 9:00 AM); Save; Send a test post; then "The test goes only to you, in your Time Off Manager app chat." No "later this week" box.

## 2026-11-20 · Apple-style look (mockup round 6 approved)
- Look only: every word, the order of things and what each button does stay as they were. Everything above still applies.
- Background: soft grey with one still sky-blue and sunlight glow behind the signed-in app. Admin Settings has a warm yellow glow instead of the flat yellow page.
- Cards: white, slightly see-through, 22px corners, soft shadow, no outline. "Your time off" has a faint blue glow top right, the Policy card a light blue tint, "Your Decision" a thin blue ring.
- Small boxes inside cards (request summary, Sick days / Flexible time, Who else is off days, policy tick box, export table) are light grey wells with no outline.
- Lists (My Requests, Manager View, Who else is off people, Blocked dates) are one grouped grey box with thin dividers between rows, not separate boxes. "Show all N requests" is the last row.
- Page titles are large and bold (28px on phones up to 34px on desktop). Card and pop-up titles are 17px.
- Font: Apple's system font on iPhone, iPad and Mac; Inter everywhere else.
- Buttons: 12px corners, bold label. Main = blue gradient with a soft glow; delete/reject = red gradient; outline = light grey fill with blue text; ghost = blue text; icon buttons are round.
- Text boxes and dropdowns: light grey fill, no outline, 12px corners; white with a blue ring when focused. Still 16px text on phones.
- Checkboxes: 20px, rounded, blue when ticked. Switches: Apple size, green when on.
- Status badges: tinted capsules with no outline (green approved, amber pending, red rejected, grey cancelled, yellow "Special approval"). Red alert boxes have a light red fill.
- Phone top bar: frosted glass, stays at the top while scrolling, with a thin line under it once content scrolls beneath. Sign-out is a round button.
- Phone menu: still 3 across with the icon above the label, drawn as a rounded grey tray; the current page is a white pill with a blue icon and label.
- Desktop sidebar: see-through panel, blue icons; the current page is a white pill.
- Pop-ups: white, 22px corners, lighter dim behind, round close button. Toast: small frosted white pill.
- Movement: buttons, rows, checkboxes and menu items press in when tapped; menu pages ease up card by card; a page opened from a list slides in from the right and Back slides in from the left; the status badge on a request pops when it changes.
- Kept light on phones: nothing moves while the screen is still; blur only on the phone top bar and the toast; movement uses transform and opacity only; "reduce motion" gets a short fade instead.

## 2026-11-20 · Lists that match (mockup round 7 approved)
- Audit Log: the entries are one grouped grey box with thin dividers, like My Requests. On phones each entry still stacks (what is in an entry is replaced by round 8 below).
- Flexible Time request page: the Make-Up Schedule rows are one grouped grey box; "Completed" is a green capsule and "Pending" a grey capsule, like the status badges.
- Flexible Time request page: the Make-Up Plan text and the "scheduled of owed" line are light grey wells. The "short" version of that line stays red.
- New Flexible Time request page: each make-up entry and the "Total make-up hours" line are light grey wells with no outline.
- Text boxes and dropdowns inside a light grey well are white, so they stand out.
- User Management (one card per person) and Policy Editor (a form) have no boxed rows and are unchanged.

## 2026-11-20 · Audit Log in plain sentences (mockup round 8 approved)
- Each entry is a sentence, not code: who did it, what they did, whose request. Names are bold. Example: "David Chen approved Maria Santos's vacation request". No full stop.
- People acting on their own request read "their": "Maria Santos asked to cancel their vacation request". A sick day reads "<name> recorded a sick day".
- Under the sentence, one small grey line joined with " · ": the request's dates ("Dec 21 – Dec 24, 2026", "Nov 4, 2026 (morning)", "Nov 11, 2026 · 13:00–15:00 (2h)"), then "In Slack" or "In the app", then "Reason: <reason>".
- A sick day's small line ends "Approved automatically".
- Not shown any more: "Actor: staff", the short request code, and the code line.
- Hand-made entries (a SQL fix, say) show their note as plain text: "Via: SQL fix · Change: afternoon off changed to morning off".
- When the person is not known the sentence starts "A manager", "An admin", "A staff member" or "The app". When the request is not known it says "a request".
- The time stays on the right (under the small line on phones). The grouped grey box, the search box and the filter are unchanged.
- Search looks through what is shown: names, dates and reasons.
