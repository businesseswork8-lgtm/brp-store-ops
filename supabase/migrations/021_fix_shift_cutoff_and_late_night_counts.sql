-- =============================================================================
-- Migration 021: Unified 6:00 AM IST Shift Cutoff & Late-Night Closing Count Repair
--
-- 1. Updates public.business_date() to use a 6:00 AM IST cutoff so that all
--    late-night closing activities (up to 6:00 AM) belong to the same Sales Day
--    (Operating Shift Date) as the shift's daytime opening.
-- 2. Repairs any br_flavour_counts closing rows that were saved 1 day too early
--    due to the client-side post-midnight double-subtraction bug.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.business_date(p_ts TIMESTAMPTZ DEFAULT now())
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_ts AT TIME ZONE 'Asia/Kolkata') - INTERVAL '6 hours')::date;
$$;

-- Heal post-midnight closing counts saved 1 day before their true Shift Operating Date
UPDATE public.br_flavour_counts c
SET count_date = public.business_date(COALESCE(c.updated_at, c.created_at))
WHERE c.session = 'closing'
  AND EXTRACT(HOUR FROM (COALESCE(c.updated_at, c.created_at) AT TIME ZONE 'Asia/Kolkata')) < 6
  AND c.count_date = public.business_date(COALESCE(c.updated_at, c.created_at)) - 1
  AND NOT EXISTS (
    SELECT 1
    FROM public.br_flavour_counts existing
    WHERE existing.store_id = c.store_id
      AND existing.item_id = c.item_id
      AND existing.session = 'closing'
      AND existing.count_date = public.business_date(COALESCE(c.updated_at, c.created_at))
  );
