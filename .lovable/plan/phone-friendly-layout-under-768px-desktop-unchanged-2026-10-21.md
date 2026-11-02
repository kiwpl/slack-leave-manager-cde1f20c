# Phone-friendly layout (under 768px), desktop unchanged

All changes use mobile-first classes that only kick in below 768px (`md:` keeps today's desktop look). No data, logic, sign-in, or backend changes.

## What changes on phones
- **Two/three-column form and detail grids** become one column: Dashboard, Submit Request, Manager Submit Request, Edit Request, Submit Flexible Time (dates + make-up entry rows), Request Detail, Flexible Time Detail.
- **Button rows and filter rows** wrap onto the next line: Dashboard header, My Requests, Manager Dashboard, Audit Log, Admin Settings, Request Detail, Flexible Time Detail, Edit Request, User Management.
- **List rows** (requests, users, audit entries) that put info and date side by side stack vertically, showing each field as "Label: value" where they are currently laid out like table columns (User Management, Audit Log, Manager Dashboard).
- **Date pickers / calendar popovers / time selects** set to full width with a max of the screen width.
- **Safety net**: page container prevents horizontal overflow, long text (emails, IDs, notes) wraps instead of pushing the page wide.
- Login, Signup, Forgot/Reset Password, Profile, Policy Editor checked and fixed the same way.

## Technical details
- Replace `grid-cols-2/3` with `grid-cols-1 md:grid-cols-2/3`; `flex gap-*` rows get `flex-wrap`, and side-by-side rows get `flex-col md:flex-row`.
- `AppLayout` main: add `min-w-0 overflow-x-hidden`; `break-words` on text-heavy cells.
- Any shadcn `Table` usage (none found in pages currently) would get a `md:hidden` card view plus `hidden md:table`.
- Verify with Playwright at 375px on each page (scrollWidth equals viewport width) and at 1280px to confirm desktop is visually unchanged.
