
CREATE POLICY "Managers and admins can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role])
);
