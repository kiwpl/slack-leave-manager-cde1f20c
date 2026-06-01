ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'cancel_requested';
ALTER TYPE public.slack_message_type ADD VALUE IF NOT EXISTS 'cancellation_request';
ALTER TABLE public.time_off_requests ADD COLUMN IF NOT EXISTS previous_status text;
ALTER TABLE public.flexible_time_requests ADD COLUMN IF NOT EXISTS cancellation_reason text, ADD COLUMN IF NOT EXISTS previous_status text;