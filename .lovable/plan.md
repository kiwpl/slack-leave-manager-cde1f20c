

## Add "Submit on Behalf of Staff" for Managers

Allow managers/office_managers/admins to create time-off requests on behalf of staff, with automatic approval.

### New Page: `src/pages/ManagerSubmitRequestPage.tsx`

A new page at route `/manager/submit-for-staff` accessible to manager, office_manager, admin, and superadmin roles. The form will:

1. **Staff selector** — dropdown of all profiles (fetched from `profiles` table) to pick which employee the request is for.
2. **Same form fields** as SubmitRequestPage: request type (vacation/sick), start date, end date, half-day toggle, reason/note.
3. **No policy acknowledgment required** (manager is submitting).
4. **No Slack ID check** on the manager — uses the selected employee's Slack ID for notifications.
5. **Auto-approve on submit** — insert with `status: "approved"`, `approval_source: "manager_on_behalf"`, `approved_at: now`, `approved_by_user_id: current manager's ID`.
6. **Side effects on submit**:
   - Insert audit log with `action_type: "manager_submitted_approved"`, `actor_type: "manager"`.
   - Trigger `send-slack-notification` with `approval_notification` to notify the employee.
   - Trigger `sync-google-calendar` with `action: "create"` to add the calendar event.
7. **Vacation reason required**, sick note optional (same rules as staff submission).
8. **Sick day date validation relaxed** — no future-date restriction since the manager may be setting upcoming planned sick days.

### Changes to Existing Files

1. **`src/App.tsx`** — Add route `/manager/submit-for-staff` with `ProtectedRoute` requiring `["manager", "office_manager", "admin", "superadmin"]`.

2. **`src/pages/ManagerDashboardPage.tsx`** — Add a "Submit for Staff" button at the top that links to the new page.

3. **`src/integrations/supabase/types.ts`** — No changes needed; `approval_source` already accepts string values, and the insert will use the existing columns.

### Technical Details

- The manager inserts into `time_off_requests` with `employee_id` set to the selected staff member's ID (not their own). This works because RLS allows managers to insert via their update policy, but we need to verify RLS. Currently only staff can insert their own (`employee_id = auth.uid()`). **A new RLS INSERT policy is needed** for managers.

- **Database migration**: Add an RLS policy on `time_off_requests` for INSERT by managers:
  ```sql
  CREATE POLICY "Managers can insert requests on behalf of staff"
  ON public.time_off_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role])
  );
  ```

- No edge function changes needed — existing `send-slack-notification` and `sync-google-calendar` functions work with any `request_id`.

