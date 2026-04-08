

## Flexible Time Request Updates

Four changes to the flexible time feature: role-restrict to office/admin staff, enforce 30-minute time intervals, enforce minimum 30-minute make-up entries, and add a reminder about same-pay-period completion requirement.

### 1. Role-Restrict Flexible Time to Office/Admin Staff

**Route protection** in `App.tsx`: Change the `/submit-flexible-time` route from open `<ProtectedRoute>` to `<ProtectedRoute requiredRoles={["office_manager", "admin", "superadmin"]}>`.

**Dashboard button** in `DashboardPage.tsx`: Wrap the "Flexible Time" button in a role check (`hasAnyRole(["office_manager", "admin", "superadmin"])`) so only eligible users see it.

**Submission page** in `SubmitFlexibleTimePage.tsx`: Add a note at the top: "Flexible time requests are available for office and admin staff only."

**My Requests / Manager Dashboard**: No changes needed — existing requests will still display regardless of role.

### 2. Enforce 30-Minute Intervals for Time Off

In `SubmitFlexibleTimePage.tsx`, add `step="1800"` (30 minutes) to the start time and end time `<Input type="time">` fields for the time-off section. Add client-side validation that both times are on 30-minute boundaries (minutes must be 0 or 30). Show inline error if not.

### 3. Enforce Minimum 30-Minute Make-Up Entries

In `SubmitFlexibleTimePage.tsx`, add `step="1800"` to the make-up entry start/end time inputs. Add validation that each make-up entry's duration is at least 30 minutes, and that times are on 30-minute boundaries. Show inline error per entry if violated.

Update the `calcHours` rounding to align with 30-minute granularity.

### 4. Add Same-Pay-Period Completion Reminder

In `SubmitFlexibleTimePage.tsx`, add an informational alert in the make-up entries section:

> "All make-up time must be completed within the same pay period as your time off."

This is already validated (make-up dates must fall within the pay period), but this adds an explicit UI reminder. Also add this note to the `FlexibleTimeDetailPage.tsx` detail view.

### Files to Edit

| File | Change |
|------|--------|
| `src/App.tsx` | Add `requiredRoles` to flexible time route |
| `src/pages/DashboardPage.tsx` | Role-gate the Flexible Time button |
| `src/pages/SubmitFlexibleTimePage.tsx` | Add role note, 30-min step/validation, min 30-min makeup validation, pay-period reminder |
| `src/pages/FlexibleTimeDetailPage.tsx` | Add pay-period completion note |

