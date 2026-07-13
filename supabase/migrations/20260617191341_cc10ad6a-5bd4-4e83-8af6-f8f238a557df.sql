-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with the same name (safe re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('flexible-time-completion-hourly');
EXCEPTION WHEN OTHERS THEN
  -- job did not exist; ignore
  NULL;
END $$;

-- Schedule the edge function to run every hour.
-- The function is deployed with verify_jwt = false (Lovable Cloud default),
-- so no Authorization header / service role key is required.
SELECT cron.schedule(
  'flexible-time-completion-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://siuseznwkuehyfvnsija.supabase.co/functions/v1/check-flexible-time-completion',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);