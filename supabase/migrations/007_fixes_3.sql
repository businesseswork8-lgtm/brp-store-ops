-- =====================================================================
-- 007_fixes_3.sql  —  Round 3 audit fixes (5 Oct 2026)
-- Run ONCE in Supabase → SQL Editor → Run, BEFORE pushing the code.
-- Safe to run again (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SECURITY: strangers must not be able to sign up and log in
-- ---------------------------------------------------------------------
-- New auth users start INACTIVE. The Super Admin "create login" route
-- switches the login on itself, so normal user creation still works.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'store', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Stop confirming every sign-up automatically (the server route confirms its own users)
DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;

-- Store logins with no store are useless and may be self sign-ups: switch them off
UPDATE public.profiles SET is_active = false
WHERE role = 'store' AND (store_access IS NULL OR cardinality(store_access) = 0);

-- ---------------------------------------------------------------------
-- 2. Alert limits: only the Super Admin may change them
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Manage variance thresholds" ON variance_thresholds;
CREATE POLICY "Manage variance thresholds" ON variance_thresholds FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------
-- 3. Store logins may only write TODAY (business day, 5 AM IST cutoff)
--    or YESTERDAY. Older days: Super Admin / Admin with "Allowed to edit".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_date() RETURNS DATE AS $$
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '5 hours')::date;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.store_can_write(p_store UUID, p_date DATE) RETURNS BOOLEAN AS $$
  SELECT public.has_store_access(p_store)
     AND p_date BETWEEN public.business_date() - 1 AND public.business_date();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "Manage stock entries for accessed stores" ON daily_stock_entries;
CREATE POLICY "Manage stock entries for accessed stores" ON daily_stock_entries FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage wastage log for accessed stores" ON daily_wastage_log;
CREATE POLICY "Manage wastage log for accessed stores" ON daily_wastage_log FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage tasting log for accessed stores" ON daily_tasting_log;
CREATE POLICY "Manage tasting log for accessed stores" ON daily_tasting_log FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage cash tally for accessed stores" ON daily_cash_tally;
CREATE POLICY "Manage cash tally for accessed stores" ON daily_cash_tally FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage sales summary for accessed stores" ON daily_sales_summary;
CREATE POLICY "Manage sales summary for accessed stores" ON daily_sales_summary FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage purchase orders for accessed stores" ON purchase_orders;
CREATE POLICY "Manage purchase orders for accessed stores" ON purchase_orders FOR ALL
  USING (public.store_can_write(store_id, entry_date)) WITH CHECK (public.store_can_write(store_id, entry_date));

DROP POLICY IF EXISTS "Manage sales items for accessed stores" ON daily_sales_items;
CREATE POLICY "Manage sales items for accessed stores" ON daily_sales_items FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_sales_summary dss WHERE dss.id = sales_summary_id
                 AND public.store_can_write(dss.store_id, dss.entry_date)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_sales_summary dss WHERE dss.id = sales_summary_id
                 AND public.store_can_write(dss.store_id, dss.entry_date)));
-- (Super Admin and editing Admins keep full access through the "Editors manage …" policies from 006.)

-- ---------------------------------------------------------------------
-- 4. Baskin Robbins stock in GRAMS:
--    stock = unopened boxes × full box weight + (open box on scale − 100 g box)
-- ---------------------------------------------------------------------
ALTER TABLE items ADD COLUMN IF NOT EXISTS full_box_grams NUMERIC;           -- ice cream in one sealed box
ALTER TABLE daily_stock_entries ADD COLUMN IF NOT EXISTS opening_open_gross NUMERIC;  -- open box as weighed (box included)
ALTER TABLE daily_stock_entries ADD COLUMN IF NOT EXISTS closing_open_gross NUMERIC;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS boxes INTEGER;          -- sealed boxes received
COMMENT ON COLUMN daily_stock_entries.opening_containers IS 'Ice cream: number of UNOPENED boxes (from 007)';
COMMENT ON COLUMN daily_stock_entries.closing_containers IS 'Ice cream: number of UNOPENED boxes (from 007)';

-- Recipes can point at "any flavour" ice cream (kept out of stock lists)
UPDATE items SET name = 'Ice cream (any flavour)' WHERE id = 'a0020000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------
-- 5. Sales By Items: save in ONE step (all or nothing)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_sales_items(p_store_id UUID, p_date DATE, p_net NUMERIC, p_items JSONB)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM daily_sales_summary WHERE store_id = p_store_id AND entry_date = p_date;
  IF v_id IS NULL THEN
    INSERT INTO daily_sales_summary (store_id, entry_date, net_sales, has_summary, submitted_by_profile_id)
    VALUES (p_store_id, p_date, p_net, false, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  DELETE FROM daily_sales_items WHERE sales_summary_id = v_id;
  INSERT INTO daily_sales_items (sales_summary_id, sku, item_type, item_name, variant, quantity_sold, unit_price, total_price, category)
  SELECT v_id, NULLIF(x->>'sku', ''), COALESCE(NULLIF(x->>'item_type', ''), 'Item'), x->>'item_name',
         NULLIF(x->>'variant', ''), ROUND((x->>'quantity_sold')::numeric), (x->>'unit_price')::numeric,
         (x->>'total_price')::numeric, NULLIF(x->>'category', '')
  FROM jsonb_array_elements(p_items) x;
  UPDATE daily_sales_summary SET has_items = true WHERE id = v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;   -- normal permissions apply

-- ---------------------------------------------------------------------
-- 6. Variance: no false alerts
--    • No "Sales By Items" for the day → NO_SALES_DATA (not an alert)
--    • Used more than sales explain → EXCEEDED
--    • Stock went UP with nothing recorded (miscount / delivery not entered) → CHECK
--    • "All ice cream" counts recipes using any flavour OR "any flavour" ice cream
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.calculate_daily_variance(UUID, DATE);
CREATE OR REPLACE FUNCTION public.calculate_daily_variance(p_store_id UUID, p_date DATE)
RETURNS TABLE (
  item_id UUID, item_name TEXT, category_name TEXT, uom TEXT,
  opening_stock NUMERIC, purchases NUMERIC, closing_stock NUMERIC,
  actual_consumption NUMERIC, theoretical_consumption NUMERIC, wastage NUMERIC, tasting NUMERIC,
  variance NUMERIC, variance_percent NUMERIC, threshold_percent NUMERIC, status TEXT
) AS $$
DECLARE
  v_brand_id UUID;
  v_base_id UUID := 'a0020000-0000-0000-0000-000000000001';
  v_has_items BOOLEAN;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;
  SELECT s.brand_id INTO v_brand_id FROM stores s WHERE s.id = p_store_id;
  SELECT EXISTS (
    SELECT 1 FROM daily_sales_summary dss JOIN daily_sales_items dsi ON dsi.sales_summary_id = dss.id
    WHERE dss.store_id = p_store_id AND dss.entry_date = p_date
  ) INTO v_has_items;

  RETURN QUERY
  WITH stock AS (
    SELECT dse.item_id, COALESCE(dse.opening_stock, 0) AS opening_stock, dse.closing_stock
    FROM daily_stock_entries dse WHERE dse.store_id = p_store_id AND dse.entry_date = p_date
  ),
  purch AS (
    SELECT po.item_id, SUM(po.quantity) AS qty FROM purchase_orders po
    WHERE po.store_id = p_store_id AND po.entry_date = p_date GROUP BY po.item_id
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
    SELECT dwl.item_id, SUM(dwl.quantity_wasted) AS qty FROM daily_wastage_log dwl
    WHERE dwl.store_id = p_store_id AND dwl.entry_date = p_date GROUP BY dwl.item_id
  ),
  taste AS (
    SELECT dtl.item_id, SUM(dtl.estimated_grams) AS qty FROM daily_tasting_log dtl
    WHERE dtl.store_id = p_store_id AND dtl.entry_date = p_date GROUP BY dtl.item_id
  ),
  flavour_ids AS (
    SELECT i.id FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.is_flavour AND ic.brand_id = v_brand_id
  ),
  base AS (
    SELECT i.id, i.name::TEXT AS name, ic.name::TEXT AS cat, ic.sort_order, i.uom::TEXT AS uom, ic.is_flavour,
           COALESCE(s.opening_stock, 0) AS op, COALESCE(p.qty, 0) AS pu, COALESCE(s.closing_stock, 0) AS cl,
           (COALESCE(s.opening_stock, 0) + COALESCE(p.qty, 0) - COALESCE(s.closing_stock, 0)) AS actual,
           COALESCE(t.theo, 0) AS theo, COALESCE(w.qty, 0) AS wst, COALESCE(ta.qty, 0) AS tst,
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
    WHERE i.is_daily_tracked AND i.is_active AND ic.brand_id = v_brand_id
      AND s.closing_stock IS NOT NULL
  ),
  combined AS (
    SELECT v_base_id AS id, 'All ice cream (flavours combined)'::TEXT AS name, 'Ice Cream'::TEXT AS cat,
           0 AS sort_order, 'grams'::TEXT AS uom,
           SUM(b.op) AS op, SUM(b.pu) AS pu, SUM(b.cl) AS cl, SUM(b.actual) AS actual,
           COALESCE((SELECT SUM(t.theo) FROM theoretical t
                     WHERE t.item_id = v_base_id OR t.item_id IN (SELECT f.id FROM flavour_ids f)), 0) AS theo,
           SUM(b.wst) AS wst, SUM(b.tst) AS tst,
           COALESCE(
             (SELECT vt.threshold_percent FROM variance_thresholds vt WHERE vt.item_id IS NULL AND vt.category_id IS NULL ORDER BY vt.updated_at DESC LIMIT 1),
             5.0) AS thr
    FROM base b WHERE b.is_flavour HAVING COUNT(*) > 0
  ),
  scored AS (
    SELECT c.id, c.name, c.cat, c.sort_order, c.uom, c.op, c.pu, c.cl, c.actual, c.theo, c.wst, c.tst, c.thr,
           false AS info_only, (c.actual - c.wst - c.tst) AS net_used
    FROM combined c
    UNION ALL
    SELECT b.id, b.name, b.cat, b.sort_order, b.uom, b.op, b.pu, b.cl, b.actual, b.theo, b.wst, b.tst, b.thr,
           b.is_flavour, (b.actual - b.wst - b.tst)
    FROM base b
  )
  SELECT x.id, x.name::TEXT, x.cat::TEXT, x.uom::TEXT,
         x.op, x.pu, x.cl, x.actual, x.theo, x.wst, x.tst,
         ROUND(x.net_used - x.theo, 2) AS variance,
         CASE WHEN x.theo > 0 AND NOT x.info_only AND v_has_items
              THEN ROUND(((x.net_used - x.theo) / x.theo) * 100, 2) ELSE NULL END AS variance_percent,
         x.thr,
         (CASE
            WHEN x.info_only THEN 'INFO'
            WHEN NOT v_has_items THEN
              CASE WHEN x.net_used < 0 THEN 'CHECK' ELSE 'NO_SALES_DATA' END
            WHEN x.theo > 0 AND ABS(((x.net_used - x.theo) / x.theo) * 100) <= x.thr THEN 'OK'
            WHEN x.theo > 0 AND x.net_used > x.theo THEN 'EXCEEDED'
            WHEN x.theo > 0 THEN 'CHECK'
            WHEN x.net_used > 0 THEN 'EXCEEDED'      -- used, but no sales explain it
            WHEN x.net_used < 0 THEN 'CHECK'         -- stock went up with nothing recorded
            ELSE 'OK'
          END)::TEXT AS status
  FROM scored x
  ORDER BY x.sort_order, x.info_only, x.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
