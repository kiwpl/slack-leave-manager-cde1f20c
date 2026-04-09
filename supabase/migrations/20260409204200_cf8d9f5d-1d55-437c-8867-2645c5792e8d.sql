ALTER TABLE public.flexible_time_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid;