-- Clear the reference so the orphaned auth user can be deleted
UPDATE vacation_policy SET updated_by_user_id = NULL WHERE updated_by_user_id = '4210da9d-3fe6-4f16-a521-fea41911b441';

-- Fix the FK constraint to SET NULL on delete to prevent this in the future
ALTER TABLE vacation_policy DROP CONSTRAINT IF EXISTS vacation_policy_updated_by_user_id_fkey;
ALTER TABLE vacation_policy ADD CONSTRAINT vacation_policy_updated_by_user_id_fkey 
  FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;