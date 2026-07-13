-- Enforce the "1 flexible time request per calendar quarter" rule server-side.
-- The browser already blocks a second request, but nothing stopped a direct
-- API call from bypassing it. This BEFORE INSERT trigger makes the database
-- itself reject an extra request in the same calendar quarter.
--
-- Quarters are CALENDAR quarters (Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep,
-- Q4 Oct–Dec). date_trunc('quarter', ...) compares two timestamps by the
-- quarter they fall in, which handles the Q4 → January rollover correctly.
-- Cancelled and rejected requests do NOT count toward the limit.

CREATE OR REPLACE FUNCTION public.enforce_flexible_time_quarterly_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count integer;
BEGIN
  SELECT COUNT(*)
    INTO existing_count
    FROM public.flexible_time_requests
   WHERE employee_id = NEW.employee_id
     AND date_trunc('quarter', submitted_at) = date_trunc('quarter', NEW.submitted_at)
     AND status NOT IN ('cancelled', 'rejected');

  IF existing_count >= 1 THEN
    RAISE EXCEPTION 'You have already used your flexible time request this quarter.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_flexible_time_quarterly_limit ON public.flexible_time_requests;

CREATE TRIGGER enforce_flexible_time_quarterly_limit
  BEFORE INSERT ON public.flexible_time_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_flexible_time_quarterly_limit();
