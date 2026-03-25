
CREATE TYPE public.day_portion AS ENUM ('full', 'am', 'pm');

ALTER TABLE public.time_off_requests 
ADD COLUMN day_portion public.day_portion NOT NULL DEFAULT 'full';
