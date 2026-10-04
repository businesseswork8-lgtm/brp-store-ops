-- ==========================================================
-- 006_fixes_after_flavours.sql
-- 1. No false alerts for Baskin Robbins flavours (combined ice cream check)
-- 2. Admins with "Allowed to edit" can save/correct store entries
-- Safe to run more than once.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. Admins with "Allowed to edit" can write store data for any store
-- ----------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_stock_entries','daily_wastage_log','daily_tasting_log','daily_cash_tally',
                           'daily_sales_summary','purchase_orders','staff_members','monthly_audit_entries']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Editors manage %1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "Editors manage %1$s" ON %1$I FOR ALL USING (public.is_editor()) WITH CHECK (public.is_editor())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Editors manage daily_sales_items" ON daily_sales_items;
CREATE POLICY "Editors manage daily_sales_items" ON daily_sales_items FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ----------------------------------------------------------
-- 2. Variance: flavours are checked together as one "All ice cream" line
--    (sales don't yet say which flavour was scooped).
--    Individual flavours show status 'INFO' (usage only, never an alert).
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.calculate_daily_variance(UUID, DATE);

CREATE OR REPLACE FUNCTION public.calculate_daily_variance(p_store_id UUID, p_date DATE)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  category_name TEXT,
  uom TEXT,
  opening_stock NUMERIC,
  purchases NUMERIC,
  closing_stock NUMERIC,
  actual_consumption NUMERIC,
  theoretical_consumption NUMERIC,
  wastage NUMERIC,
  tasting NUMERIC,
  variance NUMERIC,
  variance_percent NUMERIC,
  threshold_percent NUMERIC,
  status TEXT
) AS $$
DECLARE
  v_brand_id UUID;
  v_base_id UUID := 'a0020000-0000-0000-0000-000000000001'; -- recipes still use this generic ice cream line
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;

  SELECT s.brand_id INTO v_brand_id FROM stores s WHERE s.id = p_store_id;

  RETURN QUERY
  WITH stock AS (
    SELECT dse.item_id, COALESCE(dse.opening_stock, 0) AS opening_stock, dse.closing_stock
    FROM daily_stock_entries dse
    WHERE dse.store_id = p_store_id AND dse.entry_date = p_date
  ),
  purch AS (
    SELECT po.item_id, SUM(po.quantity) AS qty
    FROM purchase_orders po
    WHERE po.store_id = p_store_id AND po.entry_date = p_date
    GROUP BY po.item_id
  ),
  theoretical AS (
    SELECT ri.item_id, SUM(dsi.quantity_sold * ri.quantity) AS theo
    FROM daily_sales_summary dss
    JOIN daily_sales_items dsi ON dsi.sales_summary_id = dss.id
    JOIN recipes r ON r.brand_id = v_brand_id AND (
         (r.rista_sku IS NOT NULL AND r.rista_sku = dsi.sku)
      OR (r.rista_sku IS NULL AND LOWER(TRIM(r.product_name)) = LOWER(TRIM(dsi.item_name))))
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE dss.store_id = p_store_id AND dss.entry_date = p_date
    GROUP BY ri.item_id
  ),
  waste AS (
    SELECT dwl.item_id, SUM(dwl.quantity_wasted) AS qty
    FROM daily_wastage_log dwl
    WHERE dwl.store_id = p_store_id AND dwl.entry_date = p_date
    GROUP BY dwl.item_id
  ),
  taste AS (
    SELECT dtl.item_id, SUM(dtl.estimated_grams) AS qty
    FROM daily_tasting_log dtl
    WHERE dtl.store_id = p_store_id AND dtl.entry_date = p_date
    GROUP BY dtl.item_id
  ),
  base AS (
    SELECT i.id, i.name::TEXT AS name, ic.name::TEXT AS cat, ic.sort_order, i.uom::TEXT AS uom, ic.is_flavour,
           COALESCE(s.opening_stock, 0) AS op,
           COALESCE(p.qty, 0) AS pu,
           COALESCE(s.closing_stock, 0) AS cl,
           (COALESCE(s.opening_stock, 0) + COALESCE(p.qty, 0) - COALESCE(s.closing_stock, 0)) AS actual,
           COALESCE(t.theo, 0) AS theo,
           COALESCE(w.qty, 0) AS wst,
           COALESCE(ta.qty, 0) AS tst,
           COALESCE(
             (SELECT vt.threshold_percent FROM variance_thresholds vt WHERE vt.item_id = i.id ORDER BY vt.updated_at DESC LIMIT 1),
             (SELECT vt.threshold_percent FROM variance_thresholds vt WHERE vt.category_id = i.category_id AND vt.item_id IS NULL ORDER BY vt.updated_at DESC LIMIT 1),
             (SELECT vt.threshold_percent FROM variance_thresholds vt WHERE vt.item_id IS NULL AND vt.category_id IS NULL ORDER BY vt.updated_at DESC LIMIT 1),
             5.0) AS thr
    FROM items i
    JOIN item_categories ic ON ic.id = i.category_id
    LEFT JOIN stock s ON s.item_id = i.id
    LEFT JOIN purch p ON p.item_id = i.id
    LEFT JOIN theoretical t ON t.item_id = i.id
    LEFT JOIN waste w ON w.item_id = i.id
    LEFT JOIN taste ta ON ta.item_id = i.id
    WHERE i.is_daily_tracked AND i.is_active
      AND ic.brand_id = v_brand_id
      AND s.closing_stock IS NOT NULL
  ),
  -- One combined line for all flavours, compared with scoops/packs sold
  combined AS (
    SELECT v_base_id AS id, 'All ice cream (flavours combined)'::TEXT AS name, 'Ice Cream'::TEXT AS cat,
           0 AS sort_order, 'grams'::TEXT AS uom,
           SUM(b.op) AS op, SUM(b.pu) AS pu, SUM(b.cl) AS cl, SUM(b.actual) AS actual,
           COALESCE((SELECT t.theo FROM theoretical t WHERE t.item_id = v_base_id), 0) AS theo,
           SUM(b.wst) AS wst, SUM(b.tst) AS tst,
           COALESCE(
             (SELECT vt.threshold_percent FROM variance_thresholds vt WHERE vt.item_id IS NULL AND vt.category_id IS NULL ORDER BY vt.updated_at DESC LIMIT 1),
             5.0) AS thr
    FROM base b
    WHERE b.is_flavour
    HAVING COUNT(*) > 0
  ),
  scored AS (
    SELECT c.id, c.name, c.cat, c.sort_order, c.uom, c.op, c.pu, c.cl, c.actual, c.theo, c.wst, c.tst, c.thr, false AS info_only
    FROM combined c
    UNION ALL
    SELECT b.id, b.name, b.cat, b.sort_order, b.uom, b.op, b.pu, b.cl, b.actual, b.theo, b.wst, b.tst, b.thr, b.is_flavour
    FROM base b
  )
  SELECT x.id, x.name::TEXT, x.cat::TEXT, x.uom::TEXT,
         x.op, x.pu, x.cl, x.actual, x.theo, x.wst, x.tst,
         ROUND(x.actual - x.wst - x.tst - x.theo, 2) AS variance,
         CASE WHEN x.theo > 0 AND NOT x.info_only
              THEN ROUND(((x.actual - x.wst - x.tst - x.theo) / x.theo) * 100, 2)
              ELSE NULL END AS variance_percent,
         x.thr,
         (CASE
            WHEN x.info_only THEN 'INFO'          -- individual flavour: usage only
            WHEN x.theo > 0 AND ABS(((x.actual - x.wst - x.tst - x.theo) / x.theo) * 100) <= x.thr THEN 'OK'
            WHEN x.theo = 0 AND (x.actual - x.wst - x.tst) <= 0 THEN 'OK'
            ELSE 'EXCEEDED'
          END)::TEXT AS status
  FROM scored x
  ORDER BY x.sort_order, x.info_only, x.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
