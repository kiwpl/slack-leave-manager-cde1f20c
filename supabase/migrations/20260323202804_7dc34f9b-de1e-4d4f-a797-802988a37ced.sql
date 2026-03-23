
-- Enums
create type public.app_role as enum ('staff', 'manager', 'admin', 'superadmin');
create type public.user_status as enum ('active', 'inactive');
create type public.request_type as enum ('vacation', 'sick');
create type public.request_status as enum ('pending_approval', 'approved', 'rejected', 'cancelled');
create type public.approval_source as enum ('manager', 'system_auto_approved');
create type public.actor_type as enum ('staff', 'manager', 'admin', 'system');
create type public.slack_message_type as enum ('submission_confirmation', 'approval_request', 'approval_notification', 'rejection_notification', 'edit_notification', 'cancellation_notification', 'auto_approved_notification');
create type public.slack_message_state as enum ('active', 'handled', 'cancelled');
create type public.calendar_action_type as enum ('create', 'update', 'delete', 'failed');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  slack_user_id text,
  status user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User roles (separate table per security guidelines)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);

-- Time off requests
create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references auth.users(id) on delete cascade,
  request_type request_type not null,
  start_date date,
  end_date date,
  sick_date date,
  note text,
  status request_status not null default 'pending_approval',
  approval_source approval_source,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by_user_id uuid references auth.users(id),
  rejected_at timestamptz,
  rejected_by_user_id uuid references auth.users(id),
  rejection_reason text,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id),
  cancellation_reason text,
  last_edited_at timestamptz,
  last_edited_by_user_id uuid references auth.users(id),
  google_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vacation policy
create table public.vacation_policy (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  policy_content text not null,
  version_label text,
  active_flag boolean not null default true,
  updated_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Audit logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.time_off_requests(id) on delete set null,
  action_type text not null,
  actor_type actor_type not null,
  actor_id uuid references auth.users(id),
  details jsonb,
  created_at timestamptz not null default now()
);

-- Slack message tracking
create table public.slack_message_tracking (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.time_off_requests(id) on delete cascade,
  slack_message_ts text,
  slack_channel_or_dm_id text,
  slack_recipient_user_id text,
  message_type slack_message_type not null,
  current_state slack_message_state not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Calendar sync logs
create table public.calendar_sync_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.time_off_requests(id) on delete cascade,
  google_calendar_event_id text,
  action_type calendar_action_type not null,
  status text,
  error_message text,
  created_at timestamptz not null default now()
);

-- App settings (for Google Calendar ID, Slack config, etc.)
create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Security definer function for role checks (avoids RLS recursion)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Helper: check if user has any of the given roles
create or replace function public.has_any_role(_user_id uuid, _roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = any(_roles)
  )
$$;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  insert into public.user_roles (user_id, role) values (new.id, 'staff');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Updated_at trigger function
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.update_updated_at();
create trigger time_off_requests_updated_at before update on public.time_off_requests
  for each row execute procedure public.update_updated_at();
create trigger slack_message_tracking_updated_at before update on public.slack_message_tracking
  for each row execute procedure public.update_updated_at();

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.time_off_requests enable row level security;
alter table public.vacation_policy enable row level security;
alter table public.audit_logs enable row level security;
alter table public.slack_message_tracking enable row level security;
alter table public.calendar_sync_logs enable row level security;
alter table public.app_settings enable row level security;

-- RLS: profiles
create policy "Users can view own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (id = auth.uid());
create policy "Admins can update all profiles" on public.profiles
  for update to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));

-- RLS: user_roles
create policy "Users can view own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid());
create policy "Admins can view all roles" on public.user_roles
  for select to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Admins can manage roles" on public.user_roles
  for all to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));

-- RLS: time_off_requests
create policy "Staff can view own requests" on public.time_off_requests
  for select to authenticated using (employee_id = auth.uid());
create policy "Managers can view all requests" on public.time_off_requests
  for select to authenticated using (public.has_any_role(auth.uid(), array['manager','admin','superadmin']::app_role[]));
create policy "Staff can insert own requests" on public.time_off_requests
  for insert to authenticated with check (employee_id = auth.uid());
create policy "Staff can update own requests" on public.time_off_requests
  for update to authenticated using (employee_id = auth.uid());
create policy "Managers can update requests" on public.time_off_requests
  for update to authenticated using (public.has_any_role(auth.uid(), array['manager','admin','superadmin']::app_role[]));

-- RLS: vacation_policy
create policy "Everyone can read active policy" on public.vacation_policy
  for select to authenticated using (active_flag = true);
create policy "Admins can read all policies" on public.vacation_policy
  for select to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Admins can manage policy" on public.vacation_policy
  for all to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));

-- RLS: audit_logs
create policy "Staff can view own audit logs" on public.audit_logs
  for select to authenticated using (
    actor_id = auth.uid() or
    request_id in (select id from public.time_off_requests where employee_id = auth.uid())
  );
create policy "Admins can view all audit logs" on public.audit_logs
  for select to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Authenticated can insert audit logs" on public.audit_logs
  for insert to authenticated with check (true);

-- RLS: slack_message_tracking
create policy "Admins can manage slack tracking" on public.slack_message_tracking
  for all to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Service can insert slack tracking" on public.slack_message_tracking
  for insert to authenticated with check (true);

-- RLS: calendar_sync_logs
create policy "Admins can view calendar logs" on public.calendar_sync_logs
  for select to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));
create policy "Service can insert calendar logs" on public.calendar_sync_logs
  for insert to authenticated with check (true);

-- RLS: app_settings
create policy "Authenticated can read settings" on public.app_settings
  for select to authenticated using (true);
create policy "Admins can manage settings" on public.app_settings
  for all to authenticated using (public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[]));

-- Seed default vacation policy
insert into public.vacation_policy (title, policy_content, version_label, active_flag)
values (
  'Vacation and Sick Day Policy',
  E'Please review this policy before submitting a request.\n\n**Vacation Requests**\n\n- All vacation requests must be submitted through this app.\n- Vacation requests are not approved until the employee receives an approval confirmation.\n- Submitting a request does not guarantee approval.\n- Vacation requests should be submitted as early as possible to support scheduling and coverage.\n- Approval may depend on staffing needs, timing, and overlapping requests from other employees.\n\n**Sick Day Requests**\n\n- Sick days are intended for unexpected illness-related absences.\n- Sick day requests may only be submitted for today or a past date.\n- Future sick day submissions are not allowed.\n- Eligible sick day requests are automatically recorded in the system.\n- Misuse of sick day submissions may be reviewed by management.\n\n**Changes and Cancellations**\n\n- Employees may edit or cancel their own requests in the app.\n- Changes to approved vacation requests will require re-approval.\n- Employees may cancel approved vacation requests without approval, but management will be notified.\n- Cancelled approved requests will be removed from the shared calendar.\n\n**Employee Responsibility**\n\n- Employees are responsible for submitting accurate information.\n- Duplicate, misleading, or overlapping requests may be reviewed, corrected, or denied.\n\n**Policy Updates**\n\n- The company may update this policy from time to time.\n\n**Acknowledgment**\n\nBy submitting a request, you confirm that the information provided is accurate and that you have read and understood this policy.',
  'v1.0',
  true
);
