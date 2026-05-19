-- The first retroactive fix (migration 20260515000002) ran with a version of
-- the sync-google-calendar edge function that still used bare "HH:MM:SS"
-- datetime strings, which Google Calendar can misinterpret depending on the
-- stored company_timezone value. The edge function is now on v4, which sends
-- explicit UTC "Z" strings computed via Intl.DateTimeFormat.
--
-- Reset the flag so v4's retroactive pass re-runs and correctly patches all
-- existing Flexible Time Request calendar events to the right local times.
INSERT INTO public.app_settings (key, value)
VALUES ('retroactive_calendar_fix_needed', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();
