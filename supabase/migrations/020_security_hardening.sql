-- =====================================================================
-- 020_security_hardening.sql
-- Security Hardening: Fix authentication bypass vulnerabilities in RPCs,
-- enforce strict caller authorization, and revoke public/anon RPC execution.
-- Safe to execute multiple times.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FIX delete_sales_data: Prevent unauthenticated / anonymous deletion
-- Previously: IF auth.uid() IS NOT NULL AND NOT (...) allowed anon callers (auth.uid() IS NULL) to bypass authorization!
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_sales_data(p_store_id UUID DEFAULT NULL, p_date DATE DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_deleted_summaries INT := 0;
BEGIN
  -- Strictly enforce that the caller must be authenticated and authorized
  IF current_user <> 'postgres' AND (
    auth.uid() IS NULL OR NOT (
      public.is_super_admin() OR public.is_admin() OR (p_store_id IS NOT NULL AND public.has_store_access(p_store_id))
    )
  ) THEN
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

REVOKE EXECUTE ON FUNCTION public.delete_sales_data(UUID, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_sales_data(UUID, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_sales_data(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. FIX save_full_count: Enforce authorization checks before writing stock counts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_full_count(p_store_id UUID, p_date DATE, p_lines JSONB)
RETURNS JSONB AS $$
DECLARE v_brand UUID; v_saved INTEGER; v_total INTEGER;
BEGIN
  IF current_user <> 'postgres' AND (
    auth.uid() IS NULL OR NOT (
      public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to save stock counts for this store';
  END IF;

  SELECT brand_id INTO v_brand FROM stores WHERE id = p_store_id;
  SELECT count(*) INTO v_total FROM jsonb_array_elements(p_lines);
  INSERT INTO stock_counts (store_id, item_id, count_date, quantity, kind, submitted_by_profile_id)
  SELECT p_store_id, i.id, p_date,
         GREATEST((x->>'qty')::numeric, 0) * public.unit_factor(COALESCE(i.rista_unit, x->>'unit'), i.uom::text),
         'audit', auth.uid()
  FROM jsonb_array_elements(p_lines) x
  JOIN items i ON i.rista_sku = x->>'sku' AND i.is_active
  JOIN item_categories ic ON ic.id = i.category_id AND ic.brand_id = v_brand
  WHERE public.unit_factor(COALESCE(i.rista_unit, x->>'unit'), i.uom::text) IS NOT NULL
    AND COALESCE(i.tare_grams, 0) = 0            -- ice cream boxes are counted in the app
  ON CONFLICT (store_id, item_id, count_date) DO UPDATE SET quantity = EXCLUDED.quantity, kind = 'audit', updated_at = now();
  GET DIAGNOSTICS v_saved = ROW_COUNT;

  RETURN jsonb_build_object('items_in_file', v_total, 'stock_counts_saved', v_saved);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.save_full_count(UUID, DATE, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_full_count(UUID, DATE, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.save_full_count(UUID, DATE, JSONB) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. REVOKE anon execution on sensitive operational RPCs
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Ensure anon cannot trigger recalculations or data saves directly
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_sales_items') THEN
    REVOKE EXECUTE ON FUNCTION public.save_sales_items(UUID, DATE, NUMERIC, JSONB) FROM anon, public;
    GRANT EXECUTE ON FUNCTION public.save_sales_items(UUID, DATE, NUMERIC, JSONB) TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_company_audit') THEN
    REVOKE EXECUTE ON FUNCTION public.save_company_audit(UUID, DATE, DATE, TEXT, JSONB, JSONB, BOOLEAN) FROM anon, public;
    GRANT EXECUTE ON FUNCTION public.save_company_audit(UUID, DATE, DATE, TEXT, JSONB, JSONB, BOOLEAN) TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_rista_materials') THEN
    REVOKE EXECUTE ON FUNCTION public.refresh_rista_materials(UUID, JSONB) FROM anon, public;
    GRANT EXECUTE ON FUNCTION public.refresh_rista_materials(UUID, JSONB) TO authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. VERIFY Row Level Security is active on all core tables
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_wastage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_tasting_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_cash_tally ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_sales_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_sales_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS monthly_audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rista_consumption_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rista_consumption_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rista_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS company_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS company_audit_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS br_flavour_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS br_serving_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS br_sales_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS br_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_cash_transactions ENABLE ROW LEVEL SECURITY;
