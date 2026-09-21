-- Flexible time requests were invisible to the history tables.
--
-- audit_logs.request_id and slack_message_tracking.request_id both carried a
-- foreign key pointing at time_off_requests only. A flexible time request id
-- does not exist in that table, so PostgreSQL rejected EVERY insert that
-- referenced one. Nothing in the app checks those inserts for errors, so the
-- failures were silent: approvals, rejections, submissions and cancellations of
-- flexible time requests left no trace at all, and the Slack messages sent to
-- other managers were never tracked (so their Approve/Reject buttons were never
-- switched off once somebody acted).
--
-- request_id is polymorphic — it can point at either table — so the fix is to
-- drop the one-table foreign key and reproduce its ON DELETE behaviour with a
-- trigger that covers both tables.

-- ── 1. Drop the one-table foreign keys ───────────────────────────────────────

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_request_id_fkey;

ALTER TABLE public.slack_message_tracking
  DROP CONSTRAINT IF EXISTS slack_message_tracking_request_id_fkey;

-- ── 2. Reproduce the old ON DELETE behaviour for BOTH request tables ─────────
-- audit_logs kept its rows with request_id set to NULL; slack_message_tracking
-- rows were cascade-deleted.

CREATE OR REPLACE FUNCTION public.cleanup_request_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.audit_logs
     SET request_id = NULL
   WHERE request_id = OLD.id;

  DELETE FROM public.slack_message_tracking
   WHERE request_id = OLD.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_time_off_request_references ON public.time_off_requests;
CREATE TRIGGER cleanup_time_off_request_references
  AFTER DELETE ON public.time_off_requests
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_request_references();

DROP TRIGGER IF EXISTS cleanup_flexible_time_request_references ON public.flexible_time_requests;
CREATE TRIGGER cleanup_flexible_time_request_references
  AFTER DELETE ON public.flexible_time_requests
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_request_references();

-- ── 3. Indexes the dropped foreign keys used to provide ─────────────────────

CREATE INDEX IF NOT EXISTS audit_logs_request_id_idx
  ON public.audit_logs (request_id);

CREATE INDEX IF NOT EXISTS slack_message_tracking_request_id_idx
  ON public.slack_message_tracking (request_id);

-- ── 4. Let staff see the audit trail of their own flexible time requests ─────
-- The old policy only matched time_off_requests, so even once the inserts start
-- working, an employee could not read their own flexible time history.

DROP POLICY IF EXISTS "Staff can view own audit logs" ON public.audit_logs;
CREATE POLICY "Staff can view own audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR request_id IN (
      SELECT id FROM public.time_off_requests WHERE employee_id = auth.uid()
    )
    OR request_id IN (
      SELECT id FROM public.flexible_time_requests WHERE employee_id = auth.uid()
    )
  );

-- Managers already read every request; let them read the matching history too,
-- so the Timeline card on a request they are reviewing is not empty.
DROP POLICY IF EXISTS "Managers can view request audit logs" ON public.audit_logs;
CREATE POLICY "Managers can view request audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    has_any_role(
      auth.uid(),
      ARRAY['manager'::app_role, 'office_manager'::app_role,
            'admin'::app_role, 'superadmin'::app_role]
    )
  );

-- ── 5. Rebuild the history that was silently dropped ────────────────────────
-- Every flexible time request already records who submitted it, who approved or
-- rejected it and when. Those facts were never written to audit_logs because of
-- the foreign key above. Reconstruct them so past decisions — including
-- approvals that appeared to vanish — show up in the timeline and audit log.

INSERT INTO public.audit_logs (request_id, action_type, actor_type, actor_id, details, created_at)
SELECT f.id, 'flexible_time_submitted', 'staff', f.employee_id,
       jsonb_build_object('backfilled', true, 'total_hours', f.total_hours),
       f.submitted_at
  FROM public.flexible_time_requests f
 WHERE NOT EXISTS (
   SELECT 1 FROM public.audit_logs a
    WHERE a.request_id = f.id AND a.action_type = 'flexible_time_submitted'
 );

INSERT INTO public.audit_logs (request_id, action_type, actor_type, actor_id, details, created_at)
SELECT f.id, 'flexible_time_approved', 'manager', f.approved_by_user_id,
       jsonb_build_object('backfilled', true),
       f.approved_at
  FROM public.flexible_time_requests f
 WHERE f.approved_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.request_id = f.id AND a.action_type = 'flexible_time_approved'
   );

INSERT INTO public.audit_logs (request_id, action_type, actor_type, actor_id, details, created_at)
SELECT f.id, 'flexible_time_rejected', 'manager', f.rejected_by_user_id,
       jsonb_build_object('backfilled', true, 'rejection_reason', f.rejection_reason),
       f.rejected_at
  FROM public.flexible_time_requests f
 WHERE f.rejected_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.request_id = f.id AND a.action_type = 'flexible_time_rejected'
   );
