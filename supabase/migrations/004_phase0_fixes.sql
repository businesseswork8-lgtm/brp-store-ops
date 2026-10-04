-- ==========================================================
-- 004_phase0_fixes.sql
-- Phase 0: security, broken saves, brand isolation, variance logic
-- Safe to run more than once.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. SECURITY: users may not change their own role / access
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role (server-side admin API) and super admins may change anything
  IF auth.uid() IS NULL OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.store_access IS DISTINCT FROM OLD.store_access
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.can_edit IS DISTINCT FROM OLD.can_edit THEN
    RAISE EXCEPTION 'Not allowed to change role, store access or permissions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- "Allowed to edit" switch for admins (owner decision)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT false;

DROP TRIGGER IF EXISTS protect_profile_privileges ON profiles;
CREATE TRIGGER protect_profile_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- Inserting your own profile row must not let you pick a role either
DROP POLICY IF EXISTS "Users can insert own profile as store" ON profiles;

-- New signups always start as an inactive-free 'store' with no access (handled by handle_new_user)

-- Mark helper functions STABLE + fixed search_path
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.has_store_access(check_store_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active AND check_store_id = ANY(store_access));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Admins can see all stores (read only)
DROP POLICY IF EXISTS "Users can view stores they have access to" ON stores;
CREATE POLICY "Users can view stores they have access to" ON stores FOR SELECT
  USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(id));

-- Admins can read store data across stores (edits stay restricted)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_stock_entries','daily_wastage_log','daily_tasting_log','daily_cash_tally',
                           'daily_sales_summary','purchase_orders','staff_members','monthly_audit_entries']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins read %1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "Admins read %1$s" ON %1$I FOR SELECT USING (public.is_admin())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Admins read daily_sales_items" ON daily_sales_items;
CREATE POLICY "Admins read daily_sales_items" ON daily_sales_items FOR SELECT USING (public.is_admin());

-- ----------------------------------------------------------
-- 2. BROKEN SAVES: opening stock can be saved before closing
-- ----------------------------------------------------------
ALTER TABLE daily_stock_entries ALTER COLUMN closing_stock DROP NOT NULL;

-- ----------------------------------------------------------
-- 3. BRAND ISOLATION: merge duplicate categories from 001 into 002
-- ----------------------------------------------------------
DO $$
DECLARE
  pairs TEXT[][] := ARRAY[
    ['77777777-7777-7777-7777-777777777771','c1111111-1111-1111-1111-111111111111'], -- Batter
    ['77777777-7777-7777-7777-777777777772','c2222222-2222-2222-2222-222222222222'], -- Filling
    ['77777777-7777-7777-7777-777777777773','c3333333-3333-3333-3333-333333333333'], -- Topping
    ['77777777-7777-7777-7777-777777777776','c4444444-4444-4444-4444-444444444444'], -- Spread (was brand-less) -> 99P Spread
    ['77777777-7777-7777-7777-777777777774','c6666666-6666-6666-6666-666666666666'], -- Ice Cream Flavor -> Ice Cream
    ['77777777-7777-7777-7777-777777777775','c7777777-7777-7777-7777-777777777777']  -- Specialty -> Sundaes & Cones
  ];
  i INT;
BEGIN
  FOR i IN 1..array_length(pairs, 1) LOOP
    IF EXISTS (SELECT 1 FROM item_categories WHERE id = pairs[i][2]::uuid) THEN
      UPDATE items SET category_id = pairs[i][2]::uuid WHERE category_id = pairs[i][1]::uuid;
      UPDATE variance_thresholds SET category_id = pairs[i][2]::uuid WHERE category_id = pairs[i][1]::uuid;
      DELETE FROM item_categories WHERE id = pairs[i][1]::uuid;
    END IF;
  END LOOP;
END $$;

-- No category may be brand-less any more
UPDATE item_categories SET brand_id = '11111111-1111-1111-1111-111111111111' WHERE brand_id IS NULL;

-- Red Velvet discontinued (owner decision)
UPDATE items SET is_active = false WHERE name ILIKE 'Red Velvet%';

-- ----------------------------------------------------------
-- 4. RISTA POS: store branch names, SKU matching, summary fields
-- ----------------------------------------------------------
ALTER TABLE stores ADD COLUMN IF NOT EXISTS rista_branch_name TEXT;
UPDATE stores SET rista_branch_name = 'Borivali Dattapada'
  WHERE id = '33333333-3333-3333-3333-333333333333' AND rista_branch_name IS NULL;
UPDATE stores SET rista_branch_name = 'Borivali Chamunda circle'
  WHERE id = '55555555-5555-5555-5555-555555555555' AND rista_branch_name IS NULL;

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS rista_sku TEXT;

ALTER TABLE daily_sales_items ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE daily_sales_items ADD COLUMN IF NOT EXISTS item_type TEXT;   -- Item / Add On / Option
ALTER TABLE daily_sales_items ADD COLUMN IF NOT EXISTS variant TEXT;

ALTER TABLE daily_sales_summary ADD COLUMN IF NOT EXISTS service_charges NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE daily_sales_summary ADD COLUMN IF NOT EXISTS dine_in_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE daily_sales_summary ADD COLUMN IF NOT EXISTS takeaway_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE daily_sales_summary ADD COLUMN IF NOT EXISTS has_summary BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE daily_sales_summary ADD COLUMN IF NOT EXISTS has_items BOOLEAN NOT NULL DEFAULT false;

-- Allow an items-only upload to create a summary row without fake zeros being "real"
DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['gross_sales','net_sales','total_discount','total_tax','total_orders','cash_amount',
                           'upi_amount','card_amount','swiggy_amount','zomato_amount','other_online_amount']
  LOOP
    EXECUTE format('ALTER TABLE daily_sales_summary ALTER COLUMN %I SET DEFAULT 0', c);
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 5. VARIANCE: access check, purchases, honest status
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
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;

  SELECT s.brand_id INTO v_brand_id FROM stores s WHERE s.id = p_store_id;

  RETURN QUERY
  WITH stock AS (
    SELECT dse.item_id,
           COALESCE(dse.opening_stock, 0) AS opening_stock,
           dse.closing_stock
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
    SELECT i.id, i.name, ic.name AS cat, ic.sort_order, i.uom, i.category_id,
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
      AND s.closing_stock IS NOT NULL          -- only items with a completed day
  )
  SELECT b.id, b.name::TEXT, b.cat::TEXT, b.uom::TEXT,
         b.op, b.pu, b.cl, b.actual, b.theo, b.wst, b.tst,
         ROUND(b.actual - b.wst - b.tst - b.theo, 2) AS variance,
         CASE WHEN b.theo > 0
              THEN ROUND(((b.actual - b.wst - b.tst - b.theo) / b.theo) * 100, 2)
              ELSE NULL END AS variance_percent,
         b.thr,
         (CASE
            WHEN b.theo > 0 AND ABS(((b.actual - b.wst - b.tst - b.theo) / b.theo) * 100) <= b.thr THEN 'OK'
            WHEN b.theo = 0 AND (b.actual - b.wst - b.tst) <= 0 THEN 'OK'
            ELSE 'EXCEEDED'                     -- includes stock used with no sales to explain it
          END)::TEXT AS status
  FROM base b
  ORDER BY b.sort_order, b.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
