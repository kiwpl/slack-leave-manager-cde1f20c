-- Team limits: blocked dates, and how many people are already off each day.
--
-- Admins set "Most people off at once" and the warn/block rule in app_settings
-- (keys team_limit_max and team_limit_mode); no table is needed for those.

-- ── 1. Blocked dates ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT blocked_dates_range CHECK (end_date >= start_date)
);

ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read blocked dates" ON public.blocked_dates;
CREATE POLICY "Signed-in users can read blocked dates"
  ON public.blocked_dates FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage blocked dates" ON public.blocked_dates;
CREATE POLICY "Admins can manage blocked dates"
  ON public.blocked_dates FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'superadmin'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'superadmin'::app_role]));

-- ── 2. People already off, per weekday ──────────────────────────────
-- Staff can only read their own requests, so the request form asks this
-- function instead. It returns counts only (no names), leaves out the person
-- asking, and counts approved, pending and cancellation-pending vacation.
CREATE OR REPLACE FUNCTION public.people_off_per_day(_start date, _end date)
RETURNS TABLE (day date, people integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d::date AS day,
         count(DISTINCT r.employee_id)::int AS people
  FROM generate_series(_start, _end, interval '1 day') AS d
  LEFT JOIN public.time_off_requests r
    ON r.request_type = 'vacation'
   AND r.status IN ('approved', 'pending_approval', 'cancel_requested')
   AND r.start_date <= d::date
   AND r.end_date >= d::date
   AND r.employee_id <> auth.uid()
  WHERE extract(isodow FROM d) < 6
    AND _end >= _start
    AND _end - _start <= 400
  GROUP BY d
  ORDER BY d;
$$;

REVOKE ALL ON FUNCTION public.people_off_per_day(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.people_off_per_day(date, date) TO authenticated;
