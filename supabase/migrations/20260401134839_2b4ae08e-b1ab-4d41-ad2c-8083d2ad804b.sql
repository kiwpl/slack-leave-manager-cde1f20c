CREATE POLICY "Managers can insert requests on behalf of staff"
ON public.time_off_requests
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role])
);