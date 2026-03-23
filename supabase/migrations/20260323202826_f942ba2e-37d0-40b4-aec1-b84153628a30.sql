
-- Fix: Function search path mutable for update_updated_at
create or replace function public.update_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Fix: RLS Policy Always True - restrict audit_logs insert to authenticated users inserting their own actor_id
drop policy "Authenticated can insert audit logs" on public.audit_logs;
create policy "Users can insert own audit logs" on public.audit_logs
  for insert to authenticated with check (actor_id = auth.uid());

-- Fix: RLS Policy Always True - restrict slack_message_tracking insert
drop policy "Service can insert slack tracking" on public.slack_message_tracking;
create policy "Users can insert slack tracking for own requests" on public.slack_message_tracking
  for insert to authenticated with check (
    request_id in (select id from public.time_off_requests where employee_id = auth.uid())
    or public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[])
  );

-- Fix: RLS Policy Always True - restrict calendar_sync_logs insert
drop policy "Service can insert calendar logs" on public.calendar_sync_logs;
create policy "Users can insert calendar logs for own requests" on public.calendar_sync_logs
  for insert to authenticated with check (
    request_id in (select id from public.time_off_requests where employee_id = auth.uid())
    or public.has_any_role(auth.uid(), array['admin','superadmin']::app_role[])
  );
