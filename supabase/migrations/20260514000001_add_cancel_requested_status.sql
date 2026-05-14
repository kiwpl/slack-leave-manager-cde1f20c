-- Add cancel_requested to request_status enum for the admin-approval cancellation workflow
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'cancel_requested';

-- Add cancellation_request to slack_message_type so cancel-approval messages can be tracked
ALTER TYPE public.slack_message_type ADD VALUE IF NOT EXISTS 'cancellation_request';

-- Track what status to revert to if cancellation is denied
ALTER TABLE public.time_off_requests
  ADD COLUMN IF NOT EXISTS previous_status text;

-- Add cancellation fields to flexible_time_requests (regular table already has cancellation_reason)
ALTER TABLE public.flexible_time_requests
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS previous_status text;
