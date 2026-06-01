-- Helper: calculate working hours for a flexible time request, excluding the 12:00–13:00 lunch break.
CREATE OR REPLACE FUNCTION public.calculate_working_hours(
  p_start time,
  p_end time
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  raw_minutes numeric;
  lunch_start_min numeric := 720; -- 12:00
  lunch_end_min   numeric := 780; -- 13:00
  start_min       numeric;
  end_min         numeric;
  overlap_start   numeric;
  overlap_end     numeric;
  lunch_overlap   numeric;
BEGIN
  start_min := EXTRACT(HOUR FROM p_start) * 60 + EXTRACT(MINUTE FROM p_start);
  end_min   := EXTRACT(HOUR FROM p_end)   * 60 + EXTRACT(MINUTE FROM p_end);
  raw_minutes := end_min - start_min;
  IF raw_minutes <= 0 THEN RETURN 0; END IF;

  overlap_start := GREATEST(start_min, lunch_start_min);
  overlap_end   := LEAST(end_min, lunch_end_min);
  lunch_overlap := GREATEST(0, overlap_end - overlap_start);

  RETURN ROUND((raw_minutes - lunch_overlap) / 60.0, 2);
END;
$$;
