
-- Create flexible_time_requests table
CREATE TABLE public.flexible_time_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  date_off date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  total_hours numeric(4,2) NOT NULL,
  makeup_plan text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval',
  approved_at timestamptz,
  approved_by_user_id uuid,
  rejected_at timestamptz,
  rejected_by_user_id uuid,
  rejection_reason text,
  google_calendar_event_id text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create flexible_time_makeup_entries table
CREATE TABLE public.flexible_time_makeup_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.flexible_time_requests(id) ON DELETE CASCADE,
  makeup_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hours numeric(4,2) NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  google_calendar_event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.flexible_time_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flexible_time_makeup_entries ENABLE ROW LEVEL SECURITY;

-- RLS for flexible_time_requests
CREATE POLICY "Staff can view own flexible requests"
  ON public.flexible_time_requests FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

CREATE POLICY "Staff can insert own flexible requests"
  ON public.flexible_time_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Staff can update own flexible requests"
  ON public.flexible_time_requests FOR UPDATE TO authenticated
  USING (employee_id = auth.uid());

CREATE POLICY "Managers can view all flexible requests"
  ON public.flexible_time_requests FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

CREATE POLICY "Managers can update all flexible requests"
  ON public.flexible_time_requests FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

-- RLS for flexible_time_makeup_entries (access via request ownership)
CREATE POLICY "Staff can view own makeup entries"
  ON public.flexible_time_makeup_entries FOR SELECT TO authenticated
  USING (request_id IN (SELECT id FROM public.flexible_time_requests WHERE employee_id = auth.uid()));

CREATE POLICY "Staff can insert own makeup entries"
  ON public.flexible_time_makeup_entries FOR INSERT TO authenticated
  WITH CHECK (request_id IN (SELECT id FROM public.flexible_time_requests WHERE employee_id = auth.uid()));

CREATE POLICY "Staff can update own makeup entries"
  ON public.flexible_time_makeup_entries FOR UPDATE TO authenticated
  USING (request_id IN (SELECT id FROM public.flexible_time_requests WHERE employee_id = auth.uid()));

CREATE POLICY "Managers can view all makeup entries"
  ON public.flexible_time_makeup_entries FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

CREATE POLICY "Managers can update all makeup entries"
  ON public.flexible_time_makeup_entries FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['manager'::app_role, 'office_manager'::app_role, 'admin'::app_role, 'superadmin'::app_role]));

-- Add updated_at trigger for flexible_time_requests
CREATE TRIGGER update_flexible_time_requests_updated_at
  BEFORE UPDATE ON public.flexible_time_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
