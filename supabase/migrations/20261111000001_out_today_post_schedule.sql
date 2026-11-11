-- Weekday "Out today" Slack post (see supabase/functions/post-out-today).
--
-- Runs every 15 minutes from 11:00 to 14:45 UTC, Monday to Friday. That is
-- 7:00-9:45 AM Toronto time in summer and 6:00-9:45 AM in winter, so every
-- post time offered in Admin Settings (7:00-9:00 AM) is covered all year.
-- The function posts at most once a day, after the chosen time, only when an
-- admin has turned the post on, and never on a stat holiday.
--
-- Like the flexible time job, the function is deployed with verify_jwt = false
-- (Lovable Cloud default), so no key is needed here.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with the same name (safe re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('out-today-post');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'out-today-post',
  '*/15 11-14 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://siuseznwkuehyfvnsija.supabase.co/functions/v1/post-out-today',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
