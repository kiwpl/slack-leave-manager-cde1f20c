-- Set a flag that tells the sync-google-calendar edge function to run a
-- one-time retroactive correction for all Flexible Time Request calendar
-- events whose start/end times were stored in UTC instead of the company's
-- local timezone (bug introduced before v3 of the edge function).
--
-- The edge function checks this flag on its next invocation, patches every
-- affected Google Calendar event with the correct local times from the
-- database, logs each correction, then clears this flag so the correction
-- only runs once.
INSERT INTO public.app_settings (key, value)
VALUES ('retroactive_calendar_fix_needed', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();
