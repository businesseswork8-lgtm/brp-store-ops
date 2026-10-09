-- =====================================================================
-- 019_delete_oct3_sales.sql
-- Remove 3rd October 2026 test sales dump data and provide RPC to clear sales data by date
-- =====================================================================

CREATE OR REPLACE FUNCTION public.delete_sales_data(p_store_id UUID DEFAULT NULL, p_date DATE DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_deleted_summaries INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin() OR public.is_admin() OR (p_store_id IS NOT NULL AND public.has_store_access(p_store_id))) THEN
    RAISE EXCEPTION 'Not allowed to delete sales data';
  END IF;

  IF p_date IS NOT NULL THEN
    IF p_store_id IS NOT NULL THEN
      WITH deleted_s AS (
        DELETE FROM daily_sales_summary
        WHERE store_id = p_store_id AND entry_date = p_date
        RETURNING id
      )
      SELECT COUNT(*) INTO v_deleted_summaries FROM deleted_s;
    ELSE
      WITH deleted_s AS (
        DELETE FROM daily_sales_summary
        WHERE entry_date = p_date
        RETURNING id
      )
      SELECT COUNT(*) INTO v_deleted_summaries FROM deleted_s;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_summaries', v_deleted_summaries
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Immediately delete 2026-10-03 test file dump sales data across all stores
DELETE FROM daily_sales_summary WHERE entry_date = '2026-10-03';
