

## Flexible Time (Make-Up Time) Feature

This is a large feature spanning database schema, a new submission page, updates to existing views, edge functions for calendar sync and automated completion checks, and Slack notifications. Below is the full implementation plan.

---

### 1. Database Migration

**New tables:**

- `flexible_time_requests` — stores each flexible time request
  - `id` uuid PK
  - `employee_id` uuid NOT NULL
  - `date_off` date NOT NULL (the day of the time off)
  - `start_time` time NOT NULL
  - `end_time` time NOT NULL
  - `total_hours` numeric(4,2) NOT NULL
  - `makeup_plan` text NOT NULL
  - `status` text NOT NULL DEFAULT 'pending_approval' (pending_approval, approved, rejected, completed, incomplete)
  - `approved_at`, `approved_by_user_id`, `rejected_at`, `rejected_by_user_id`, `rejection_reason` — mirrors existing pattern
  - `google_calendar_event_id` text (for the time-off event)
  - `submitted_at` timestamptz DEFAULT now()
  - `pay_period_start` date NOT NULL (computed at insert time)
  - `pay_period_end` date NOT NULL
  - `created_at`, `updated_at` timestamptz

- `flexible_time_makeup_entries` — each proposed make-up block
  - `id` uuid PK
  - `request_id` uuid FK → flexible_time_requests
  - `makeup_date` date NOT NULL
  - `start_time` time NOT NULL
  - `end_time` time NOT NULL
  - `hours` numeric(4,2) NOT NULL
  - `completed` boolean DEFAULT false
  - `google_calendar_event_id` text
  - `created_at` timestamptz

**New enum-like status:** Use text column (not DB enum) for the 5 statuses to avoid migration complexity. Validate in app code.

**Admin setting:** Add `pay_period_anchor_date` to `app_settings` (text, format `YYYY-MM-DD`).

**RLS policies** on both new tables:
- Staff can INSERT/SELECT/UPDATE own records (`employee_id = auth.uid()`)
- Managers/admins can SELECT/UPDATE all records

---

### 2. New Page: `src/pages/SubmitFlexibleTimePage.tsx`

Route: `/submit-flexible-time` (protected, all authenticated users)

**Form fields:**
- Date of time off (date picker, must be in the future)
- Start time and end time (time inputs)
- Auto-calculated total hours (displayed, validated <= 4 hours)
- Make-up plan (required textarea)
- Make-up entries: dynamic list where user adds date + start/end time per block. Each entry auto-calculates hours. Total make-up hours must equal total hours requested.

**Client-side validation (all shown inline before submit):**
1. Total hours <= 4
2. Date must be in the future (no retroactive)
3. Check if employee already has a flexible time request this calendar month — query `flexible_time_requests` for same `employee_id` in current month. Hard block if found.
4. Make-up dates must fall within the same pay period as the time-off date (computed using the anchor date from `app_settings`)
5. Make-up hours per week: sum all make-up entries in a given week; block if any week exceeds 4 extra hours
6. Make-up total must equal time-off total

**Eligibility banner:** Show "You have used 0 of 1 flexible time request this month" or "You have already used your flexible time request this month."

**On submit:**
- Insert into `flexible_time_requests` with status `pending_approval`
- Insert all make-up entries into `flexible_time_makeup_entries`
- Insert audit log
- Trigger `send-slack-notification` with a new notification type `flexible_time_request`
- Navigate to detail page

---

### 3. New Page: `src/pages/FlexibleTimeDetailPage.tsx`

Route: `/flexible-time/:id` (protected)

Displays request details, make-up schedule with completion status, audit history. Manager actions: Approve / Reject buttons (no override or exception options).

On approval:
- Update status to `approved`
- Trigger calendar sync (time-off event + make-up events)
- Notify employee via Slack

On rejection:
- Update status to `rejected`
- Notify employee via Slack

---

### 4. Existing View Updates

**`DashboardPage.tsx`** — Add a "Submit Flexible Time" button next to existing "New Request". Show flexible time requests in the recent requests list with a "Flexible Time" type badge.

**`MyRequestsPage.tsx`** — Fetch and display `flexible_time_requests` alongside `time_off_requests`. Add "flexible" to the type filter. Show status badges including "Completed" and "Incomplete".

**`ManagerDashboardPage.tsx`** — Fetch and display `flexible_time_requests` in the same list. Link to `FlexibleTimeDetailPage` for approval actions.

**`StatusBadge.tsx`** — Add `completed` (green variant) and `incomplete` (red/warning variant) status styles.

**`App.tsx`** — Add routes for `/submit-flexible-time` and `/flexible-time/:id`.

---

### 5. Google Calendar Sync

**Update `sync-google-calendar/index.ts`:**

Accept a new optional field in the payload: `flexible_time_request_id`.

When present:
- **Create (on approval):** Create a timed event (not all-day) for the time off: title "Flexible Time Off - [Name]", start/end datetime. Create separate events for each make-up entry: title "Make-Up Time - [Name]". Store event IDs on respective records.
- **Delete:** Remove events if request is cancelled/rejected.
- **Update (on incomplete):** Patch make-up event titles to "Incomplete Make-Up Time - [Name]".

Add an `action: "update"` handler to the existing function for title patches.

---

### 6. Slack Notifications

**Update `send-slack-notification/index.ts`:**

Add notification types:
- `flexible_time_request` — notify managers with Approve/Reject buttons
- `flexible_time_approved` — notify employee
- `flexible_time_rejected` — notify employee
- `flexible_time_incomplete` — notify manager and admin
- `flexible_time_reminder` — mid-period reminder to manager

**Update `slack-approval-handler/index.ts`:**

Handle approve/reject actions for flexible time requests (check if request_id exists in `flexible_time_requests` table).

---

### 7. Automated Completion Check Edge Function

**New edge function: `supabase/functions/check-flexible-time-completion/index.ts`**

Scheduled via `pg_cron` to run daily.

Logic:
1. Find all `flexible_time_requests` with status `approved` where `pay_period_end <= today`.
2. For each, check if all `flexible_time_makeup_entries` have their `makeup_date` in the past (auto-completion based on date passing, per user's choice).
3. Mark entries as `completed = true` if date has passed.
4. If all entries completed → set request status to `completed`.
5. If pay period ended and not all entries completed → set status to `incomplete`, trigger Slack notification to manager and admin, log audit entry.

**Mid-period reminder:** Same function checks for approved requests where pay period is >50% elapsed and make-up entries still have future dates — sends reminder to manager.

---

### 8. Admin Settings Update

**`AdminSettingsPage.tsx`** — Add a "Pay Period Anchor Date" field. This is the start date of any known bi-weekly pay period (e.g., "2025-01-06"). The system calculates all pay period boundaries from this anchor.

---

### 9. Pay Period Calculation Helper

**New file: `src/lib/payPeriod.ts`**

```text
function getPayPeriod(date: Date, anchorDate: Date): { start: Date, end: Date }
```

Given a bi-weekly anchor, compute which 2-week window any date falls into. Used both client-side (validation) and in the edge function.

Duplicate logic in the edge function (Deno) since it can't import from `src/`.

---

### Summary of Files

| Action | File |
|--------|------|
| Create | `supabase/migrations/xxx_flexible_time.sql` |
| Create | `src/pages/SubmitFlexibleTimePage.tsx` |
| Create | `src/pages/FlexibleTimeDetailPage.tsx` |
| Create | `src/lib/payPeriod.ts` |
| Create | `supabase/functions/check-flexible-time-completion/index.ts` |
| Edit | `src/App.tsx` — add 2 routes |
| Edit | `src/pages/DashboardPage.tsx` — add flexible time button + list |
| Edit | `src/pages/MyRequestsPage.tsx` — fetch + display flexible time |
| Edit | `src/pages/ManagerDashboardPage.tsx` — fetch + display flexible time |
| Edit | `src/components/StatusBadge.tsx` — add completed/incomplete |
| Edit | `src/pages/AdminSettingsPage.tsx` — add pay period anchor |
| Edit | `supabase/functions/sync-google-calendar/index.ts` — timed events + update action |
| Edit | `supabase/functions/send-slack-notification/index.ts` — new notification types |
| Edit | `supabase/functions/slack-approval-handler/index.ts` — handle flexible time approvals |

This is a large feature. I recommend implementing it in phases: database + submission form first, then approval workflow, then calendar sync, then automated completion tracking.

