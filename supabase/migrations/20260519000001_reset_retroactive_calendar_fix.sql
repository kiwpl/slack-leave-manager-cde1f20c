-- Previous retroactive passes used an incorrect UTC-conversion approach that
-- still resulted in wrong times when company_timezone was set to "UTC".
-- The edge function is now on v5, which sends plain local-time datetime strings
-- paired with the explicit timeZone field — the documented Google Calendar API
-- approach that correctly interprets local times regardless of any UTC default.
--
-- Reset the flag so v5's retroactive pass re-runs and correctly patches all
-- existing Flexible Time Request calendar events to the right local times.
INSERT INTO public.app_settings (key, value)
VALUES ('retroactive_calendar_fix_needed', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();
