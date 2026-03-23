
# Employee Vacation & Sick Day Management App

## Overview
Internal tool for staff to submit vacation/sick day requests, with Slack-based manager approvals and Google Calendar sync. Built on React + Supabase (external project).

## Phase 1: Database & Auth Foundation

### Supabase Schema
- **profiles** table (id, full_name, email, slack_user_id, status)
- **user_roles** table (user_id, role enum: staff/manager/admin/superadmin) — separate table for security
- **time_off_requests** table with all fields from spec (request_type, status, dates, approval/rejection metadata, google_calendar_event_id, etc.)
- **vacation_policy** table (title, policy_content, version_label, active_flag, updated_by)
- **audit_logs** table (request_id, action_type, actor_type, actor_id, details)
- **slack_message_tracking** table (request_id, slack_message_ts, channel/dm_id, recipient_user_id, message_type, current_state)
- **calendar_sync_logs** table (request_id, event_id, action_type, status, error_message)

### RLS Policies
- Staff see only their own requests
- Managers see requests they need to act on
- Admins see everything
- Use `has_role()` security definer function to avoid recursive RLS

### Auth
- Supabase email/password auth
- Auto-create profile on signup via trigger
- Admin manages user activation (only active users can log in)

### Seed default policy
- Insert the default vacation/sick day policy text (no demo data)

## Phase 2: Core UI Pages

### Login Page
- Email/password login, redirect based on role

### Staff Dashboard
- Policy displayed prominently at top in highlighted card
- Quick stats (pending, approved, upcoming time off)
- Quick action buttons to submit requests

### Submit Request Page
- Policy displayed at top again
- Request type selector (Vacation / Sick Day)
- Dynamic form fields based on type
- Vacation: start date, end date, optional note; validate start ≤ end
- Sick day: sick date (must be today or past), optional note; future dates blocked with clear message
- Required "I have read and understand the policy" checkbox
- Inline validation errors

### My Requests Page
- Filterable/sortable list of own requests
- Status badges (Pending Approval, Approved, Rejected, Cancelled, Auto-Approved)
- Edit/Cancel action buttons based on status rules

### Request Detail Page
- Full request info with timeline of actions (submitted → approved/rejected → edited → cancelled)
- Google Calendar sync status for approved requests
- Edit/Cancel buttons per rules

### Edit Request Flow
- Pre-filled form respecting edit rules per status:
  - Pending vacation: edit dates/note, stays pending
  - Approved vacation: edit dates/note → back to pending, calendar event removed
  - Rejected vacation: edit and resubmit as new approval cycle
  - Approved sick day: edit note only, cannot change date to future

### Cancel Request Flow
- Confirmation dialog
- Approved vacation cancellation requires cancellation reason
- All cancellations update status, remove calendar events, notify via Slack

## Phase 3: Manager & Admin UI

### Manager Dashboard
- View pending vacation requests needing approval (primarily handled in Slack, but viewable in-app)
- View team request history

### Admin Settings Page
- User management: list users, set roles, activate/deactivate, map Slack user IDs
- Policy editor: edit vacation/sick day policy text (rich text or markdown)
- Integration settings: Slack configuration, Google Calendar ID setting, test modes

### Audit Log Page
- Searchable/filterable log of all actions
- Shows actor, action, timestamp, details

## Phase 4: Slack Integration (Custom Slack App)

### Edge Functions
1. **send-slack-notification** — Sends DMs to employees and managers with appropriate messages
2. **slack-approval-handler** — Receives interactive button callbacks (approve/reject)
   - Validates first-action-wins (checks request status before processing)
   - Updates request status, stores approver/rejector info
   - Updates all other manager approval messages to "Already handled"
   - Triggers calendar sync on approval
   - Sends confirmation DM to employee
3. **slack-events** — Webhook endpoint for Slack event verification

### Message Types
- Submission confirmation to employee
- Approval request to all managers (with Approve/Reject buttons)
- Approval/rejection notification to employee
- Edit notification to managers
- Cancellation notification to managers
- Auto-approved sick day notification to employee (and optionally managers)

### Slack Message Tracking
- Store message timestamps to enable updating stale approval cards
- Track current state of each message

## Phase 5: Google Calendar Integration

### Edge Function: **sync-google-calendar**
- Create calendar events for approved requests ("[Name] - Vacation" / "[Name] - Sick Day")
- Delete calendar events when approved requests are edited (sent back for re-approval) or cancelled
- Store Google Calendar event ID on request record
- Log all sync actions to calendar_sync_logs
- Only sync approved requests — never pending/rejected/cancelled
- Use service account credentials from Supabase secrets

### Admin Configuration
- Shared calendar ID configurable in admin settings
- Test mode toggle

## Key Workflow Integrity
- All status transitions are validated server-side in edge functions
- Slack interactive callbacks are idempotent (check status before acting)
- Audit logs capture every action with actor and timestamp
- Calendar sync is one-way (app → Google Calendar only)
- No demo data seeded — clean start
