-- Fix audit_logs FK to SET NULL on delete
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey 
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fix time_off_requests FKs
ALTER TABLE time_off_requests DROP CONSTRAINT IF EXISTS time_off_requests_employee_id_fkey;
ALTER TABLE time_off_requests DROP CONSTRAINT IF EXISTS time_off_requests_approved_by_user_id_fkey;
ALTER TABLE time_off_requests DROP CONSTRAINT IF EXISTS time_off_requests_rejected_by_user_id_fkey;
ALTER TABLE time_off_requests DROP CONSTRAINT IF EXISTS time_off_requests_cancelled_by_user_id_fkey;
ALTER TABLE time_off_requests DROP CONSTRAINT IF EXISTS time_off_requests_last_edited_by_user_id_fkey;
