-- Make-up hours were measured with a different ruler than the time off.
--
-- Time off is stored as WORKING hours: calculate_working_hours() subtracts the
-- 12:00–13:00 lunch break. Make-up entries were stored as raw clock time, with
-- no lunch deduction. So 08:30–13:30 off was correctly recorded as 4 working
-- hours, while a make-up block of 08:30–12:30 was recorded as 4 hours even
-- though only 3.5 of those hours are working time. The "make-up must equal time
-- off" check compared 4 against 4 and passed, leaving the employee 30 minutes
-- short.
--
-- Nothing stopped a make-up block from being scheduled during the very hours
-- the employee is off, either — 08:30–12:30 sits inside a 08:30–13:30 absence.

-- ── 1. Time off hours are always working hours ──────────────────────────────

CREATE OR REPLACE FUNCTION public.set_flexible_time_total_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.total_hours := public.calculate_working_hours(NEW.start_time, NEW.end_time);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_flexible_time_total_hours ON public.flexible_time_requests;
CREATE TRIGGER set_flexible_time_total_hours
  BEFORE INSERT OR UPDATE OF start_time, end_time ON public.flexible_time_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_flexible_time_total_hours();

-- ── 2. Make-up hours are always working hours too ───────────────────────────

CREATE OR REPLACE FUNCTION public.set_makeup_entry_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.hours := public.calculate_working_hours(NEW.start_time, NEW.end_time);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_makeup_entry_hours ON public.flexible_time_makeup_entries;
CREATE TRIGGER set_makeup_entry_hours
  BEFORE INSERT OR UPDATE ON public.flexible_time_makeup_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_makeup_entry_hours();

-- ── 3. Correct the rows already stored with raw clock hours ─────────────────
-- Entries that never touched lunch are unchanged. Entries that overlapped lunch
-- drop to their true working hours, which makes any existing shortfall visible
-- instead of hiding it behind a number that was never real.

UPDATE public.flexible_time_makeup_entries
   SET hours = public.calculate_working_hours(start_time, end_time)
 WHERE hours IS DISTINCT FROM public.calculate_working_hours(start_time, end_time);

UPDATE public.flexible_time_requests
   SET total_hours = public.calculate_working_hours(start_time, end_time)
 WHERE total_hours IS DISTINCT FROM public.calculate_working_hours(start_time, end_time);

-- ── 4. Make-up time cannot be scheduled during the time off itself ──────────
-- Applied to new entries only, so the correction above does not trip over
-- historical rows that were accepted before this rule existed.

CREATE OR REPLACE FUNCTION public.validate_makeup_entry_not_during_time_off()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  off_date  date;
  off_start time;
  off_end   time;
BEGIN
  SELECT date_off, start_time, end_time
    INTO off_date, off_start, off_end
    FROM public.flexible_time_requests
   WHERE id = NEW.request_id;

  IF off_date IS NOT NULL
     AND NEW.makeup_date = off_date
     AND NEW.start_time < off_end
     AND NEW.end_time   > off_start
  THEN
    RAISE EXCEPTION
      'Make-up time (% %–%) overlaps the time off being made up (% %–%). Pick a different time.',
      NEW.makeup_date, NEW.start_time, NEW.end_time, off_date, off_start, off_end;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_makeup_entry_not_during_time_off
  ON public.flexible_time_makeup_entries;
CREATE TRIGGER validate_makeup_entry_not_during_time_off
  BEFORE INSERT ON public.flexible_time_makeup_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_makeup_entry_not_during_time_off();

-- ── 5. A flexible time request must belong to a real user ───────────────────
-- time_off_requests.employee_id references auth.users and cascades on delete;
-- flexible_time_requests.employee_id had no constraint at all, so a deleted
-- user left their flexible time requests behind with no profile to join to —
-- which is what renders as "Unknown" on the manager dashboard.
--
-- Added NOT VALID: it enforces the rule on everything from now on without
-- deleting any request that is already orphaned.

ALTER TABLE public.flexible_time_requests
  DROP CONSTRAINT IF EXISTS flexible_time_requests_employee_id_fkey;

ALTER TABLE public.flexible_time_requests
  ADD CONSTRAINT flexible_time_requests_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;
