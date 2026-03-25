-- Update time_off_requests policies to include office_manager
DROP POLICY IF EXISTS "Managers can view all requests" ON public.time_off_requests;
CREATE POLICY "Managers can view all requests"
  ON public.time_off_requests FOR SELECT
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

DROP POLICY IF EXISTS "Managers can update requests" ON public.time_off_requests;
CREATE POLICY "Managers can update requests"
  ON public.time_off_requests FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

-- Allow managers and office_managers to view all profiles (needed for dashboard joins)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Managers and admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

-- Allow office_managers to update profiles (for setting Slack IDs)
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Managers and admins can update all profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

-- Allow office_managers to view roles (needed for user management)
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Managers and admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));