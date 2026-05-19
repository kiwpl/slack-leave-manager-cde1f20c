-- Server-side validation: makeup hours must equal time off hours
CREATE OR REPLACE FUNCTION public.validate_flexible_time_makeup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  total_makeup numeric;
  request_hours numeric;
BEGIN
  SELECT COALESCE(SUM(hours), 0) INTO total_makeup
  FROM public.flexible_time_makeup_entries
  WHERE request_id = NEW.request_id;

  SELECT total_hours INTO request_hours
  FROM public.flexible_time_requests
  WHERE id = NEW.request_id;

  IF request_hours IS NOT NULL AND ABS(total_makeup - request_hours) > 0.01 THEN
    -- Allow incremental inserts: only enforce when totals are over the required amount.
    -- If total exceeds, block immediately. If less, will be checked at request submission level.
    IF total_makeup > request_hours + 0.01 THEN
      RAISE EXCEPTION 'Make-up time (%h) exceeds time off (%h)', total_makeup, request_hours;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_makeup_hours ON public.flexible_time_makeup_entries;
CREATE TRIGGER check_makeup_hours
AFTER INSERT OR UPDATE ON public.flexible_time_makeup_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_flexible_time_makeup();