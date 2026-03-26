ALTER TABLE time_off_requests ADD COLUMN start_day_portion day_portion NOT NULL DEFAULT 'full';
ALTER TABLE time_off_requests ADD COLUMN end_day_portion day_portion NOT NULL DEFAULT 'full';

-- Migrate existing data: copy day_portion to end_day_portion for backward compat
UPDATE time_off_requests SET end_day_portion = day_portion WHERE day_portion != 'full';