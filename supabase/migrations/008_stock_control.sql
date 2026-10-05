-- =====================================================================
-- 008_stock_control.sql — Stock control like the company audit (5 Oct 2026)
--   System stock = last count + received − wastage − used by sales (Rista)
--   Variance     = actual count − system stock;  ₹ = variance × rate
-- Run ONCE in Supabase → SQL Editor → Run, BEFORE pushing the code. Safe to re-run.
-- Requires 007_fixes_3.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Item settings
-- ---------------------------------------------------------------------
ALTER TABLE items ADD COLUMN IF NOT EXISTS rista_sku TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS rate NUMERIC;                 -- ₹ per Rista unit (per kg / per piece / per litre)
ALTER TABLE items ADD COLUMN IF NOT EXISTS rista_unit TEXT;              -- unit Rista uses: kg / Nos / lt
ALTER TABLE items ADD COLUMN IF NOT EXISTS count_frequency TEXT NOT NULL DEFAULT 'none';
ALTER TABLE items ADD COLUMN IF NOT EXISTS stock_group TEXT;             -- Cakes & Pastries / Raw Material / Packaging / Other

DO $$ BEGIN
  ALTER TABLE items ADD CONSTRAINT items_count_frequency_check
    CHECK (count_frequency IN ('daily', 'fortnightly', 'monthly', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One Rista SKU per brand
CREATE OR REPLACE FUNCTION public.item_brand(p_item UUID) RETURNS UUID AS $$
  SELECT ic.brand_id FROM items i JOIN item_categories ic ON ic.id = i.category_id WHERE i.id = p_item;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
CREATE INDEX IF NOT EXISTS items_rista_sku_idx ON items(rista_sku) WHERE rista_sku IS NOT NULL;

-- Store-level item groups used by the audit (one per brand)
INSERT INTO item_categories (id, brand_id, name, sort_order) VALUES
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cakes & Pastries', 20),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Packaging', 30),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Other Raw Material', 25),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Miscellaneous', 40),
  ('ca000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Packaging', 30),
  ('ca000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'Miscellaneous', 40)
ON CONFLICT (id) DO NOTHING;

-- Editors (Super Admin, or Admin with "Allowed to edit") manage items and categories
DROP POLICY IF EXISTS "Editors manage items" ON items;
CREATE POLICY "Editors manage items" ON items FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ---------------------------------------------------------------------
-- 2. Unit conversion: Rista unit → app unit
--    (old app items are in grams / ml / pieces, Rista uses kg / lt / Nos)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unit_factor(p_rista_unit TEXT, p_uom TEXT) RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN lower(coalesce(p_rista_unit, '')) IN ('kg', 'kgs', 'kilogram') AND p_uom = 'grams' THEN 1000
    WHEN lower(coalesce(p_rista_unit, '')) IN ('lt', 'ltr', 'l', 'litre', 'liter') AND p_uom = 'ml' THEN 1000
    WHEN lower(coalesce(p_rista_unit, '')) IN ('g', 'gm', 'gms', 'gram') AND p_uom = 'grams' THEN 1
    WHEN lower(coalesce(p_rista_unit, '')) IN ('ml') AND p_uom = 'ml' THEN 1
    WHEN lower(coalesce(p_rista_unit, '')) IN ('nos', 'no', 'pcs', 'pc', 'ea', 'pkt', 'piece', 'pieces') AND p_uom = 'pieces' THEN 1
    ELSE NULL     -- units don't fit (e.g. kg vs pieces): flagged in the report
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 3. Stock counts (actual stock, counted at closing of a business day)
--    kind = 'starting' when an item is created with the stock on hand
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  count_date DATE NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),     -- in the item's app unit (grams / ml / pieces)
  kind TEXT NOT NULL DEFAULT 'count' CHECK (kind IN ('count', 'starting', 'audit')),
  staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  submitted_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, item_id, count_date)
);
CREATE INDEX IF NOT EXISTS stock_counts_lookup ON stock_counts(store_id, item_id, count_date DESC);
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS update_stock_counts_updated_at ON stock_counts;
CREATE TRIGGER update_stock_counts_updated_at BEFORE UPDATE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "View stock counts" ON stock_counts;
CREATE POLICY "View stock counts" ON stock_counts FOR SELECT
  USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));
DROP POLICY IF EXISTS "Store writes stock counts" ON stock_counts;
CREATE POLICY "Store writes stock counts" ON stock_counts FOR ALL
  USING (public.store_can_write(store_id, count_date)) WITH CHECK (public.store_can_write(store_id, count_date));
DROP POLICY IF EXISTS "Editors manage stock counts" ON stock_counts;
CREATE POLICY "Editors manage stock counts" ON stock_counts FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ---------------------------------------------------------------------
-- 4. Rista "Consumption Variance" uploads (what sales used, per SKU)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rista_consumption_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  file_name TEXT,
  submitted_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE TABLE IF NOT EXISTS rista_consumption_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES rista_consumption_uploads(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT,
  category TEXT,
  unit TEXT,
  ideal_qty NUMERIC NOT NULL DEFAULT 0,    -- used by sales, in Rista unit
  rate NUMERIC                             -- ₹ per Rista unit
);
CREATE INDEX IF NOT EXISTS rista_lines_upload ON rista_consumption_lines(upload_id, sku);
ALTER TABLE rista_consumption_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rista_consumption_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View consumption uploads" ON rista_consumption_uploads;
CREATE POLICY "View consumption uploads" ON rista_consumption_uploads FOR SELECT
  USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));
DROP POLICY IF EXISTS "Manage consumption uploads" ON rista_consumption_uploads;
CREATE POLICY "Manage consumption uploads" ON rista_consumption_uploads FOR ALL
  USING (public.is_editor() OR public.store_can_write(store_id, date_to))
  WITH CHECK (public.is_editor() OR public.store_can_write(store_id, date_to));

DROP POLICY IF EXISTS "View consumption lines" ON rista_consumption_lines;
CREATE POLICY "View consumption lines" ON rista_consumption_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM rista_consumption_uploads u WHERE u.id = upload_id
    AND (public.is_super_admin() OR public.is_admin() OR public.has_store_access(u.store_id))));
DROP POLICY IF EXISTS "Manage consumption lines" ON rista_consumption_lines;
CREATE POLICY "Manage consumption lines" ON rista_consumption_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM rista_consumption_uploads u WHERE u.id = upload_id
    AND (public.is_editor() OR public.store_can_write(u.store_id, u.date_to))))
  WITH CHECK (EXISTS (SELECT 1 FROM rista_consumption_uploads u WHERE u.id = upload_id
    AND (public.is_editor() OR public.store_can_write(u.store_id, u.date_to))));

-- Save one upload in one step; refuses dates that overlap an earlier upload
CREATE OR REPLACE FUNCTION public.save_rista_consumption(
  p_store_id UUID, p_from DATE, p_to DATE, p_file TEXT, p_lines JSONB, p_replace BOOLEAN DEFAULT false)
RETURNS UUID AS $$
DECLARE v_id UUID; v_overlap TEXT;
BEGIN
  IF p_to < p_from THEN RAISE EXCEPTION 'The "to" date is before the "from" date'; END IF;
  SELECT string_agg(to_char(date_from, 'DD Mon') || '–' || to_char(date_to, 'DD Mon'), ', ') INTO v_overlap
  FROM rista_consumption_uploads
  WHERE store_id = p_store_id AND date_from <= p_to AND date_to >= p_from;
  IF v_overlap IS NOT NULL THEN
    IF NOT p_replace THEN
      RAISE EXCEPTION 'OVERLAP: these dates are already uploaded (%)', v_overlap;
    END IF;
    DELETE FROM rista_consumption_uploads
    WHERE store_id = p_store_id AND date_from <= p_to AND date_to >= p_from;
  END IF;
  INSERT INTO rista_consumption_uploads (store_id, date_from, date_to, file_name, submitted_by_profile_id)
  VALUES (p_store_id, p_from, p_to, p_file, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO rista_consumption_lines (upload_id, sku, name, category, unit, ideal_qty, rate)
  SELECT v_id, x->>'sku', x->>'name', x->>'category', x->>'unit',
         COALESCE((x->>'ideal_qty')::numeric, 0), NULLIF(x->>'rate', '')::numeric
  FROM jsonb_array_elements(p_lines) x
  WHERE COALESCE(x->>'sku', '') <> '';
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ---------------------------------------------------------------------
-- 5. The report
--    p_from NULL → each item from its previous count to its latest count up to p_to
--    p_from set  → stock counted on/before p_from  →  latest count on/before p_to
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.stock_variance_report(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.stock_variance_report(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  item_id UUID, item_name TEXT, stock_group TEXT, uom TEXT, rista_unit TEXT, count_frequency TEXT,
  rista_sku TEXT, rate NUMERIC,
  opening_date DATE, opening NUMERIC, received NUMERIC, wastage NUMERIC, used NUMERIC,
  system_closing NUMERIC, closing_date DATE, actual_closing NUMERIC,
  variance NUMERIC, variance_percent NUMERIC, variance_amount NUMERIC,
  days INTEGER, days_with_sales_data INTEGER, status TEXT
) AS $$
DECLARE v_brand UUID;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;
  SELECT s.brand_id INTO v_brand FROM stores s WHERE s.id = p_store_id;

  RETURN QUERY
  WITH it AS (
    SELECT i.id, i.name::TEXT AS name, COALESCE(i.stock_group, ic.name)::TEXT AS grp, i.uom::TEXT AS uom,
           i.rista_unit, i.count_frequency, i.rista_sku, i.rate
    FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.brand_id = v_brand AND i.is_active
  ),
  closing AS (                                  -- latest count on/before p_to
    SELECT DISTINCT ON (sc.item_id) sc.item_id, sc.count_date, sc.quantity
    FROM stock_counts sc WHERE sc.store_id = p_store_id AND sc.count_date <= p_to
    ORDER BY sc.item_id, sc.count_date DESC
  ),
  opening AS (                                  -- the count the period starts from
    SELECT DISTINCT ON (sc.item_id) sc.item_id, sc.count_date, sc.quantity
    FROM stock_counts sc JOIN closing c ON c.item_id = sc.item_id
    WHERE sc.store_id = p_store_id
      AND sc.count_date < c.count_date
      AND (p_from IS NULL OR sc.count_date <= p_from)
    ORDER BY sc.item_id, sc.count_date DESC
  ),
  win AS (
    SELECT it.*, o.count_date AS od, o.quantity AS oq, c.count_date AS cd, c.quantity AS cq
    FROM it JOIN closing c ON c.item_id = it.id JOIN opening o ON o.item_id = it.id
  ),
  rec AS (
    SELECT w.id, SUM(po.quantity) AS q FROM win w
    JOIN purchase_orders po ON po.item_id = w.id AND po.store_id = p_store_id
     AND po.entry_date > w.od AND po.entry_date <= w.cd
    GROUP BY w.id
  ),
  wst AS (
    SELECT w.id, SUM(dw.quantity_wasted) AS q FROM win w
    JOIN daily_wastage_log dw ON dw.item_id = w.id AND dw.store_id = p_store_id
     AND dw.entry_date > w.od AND dw.entry_date <= w.cd
    GROUP BY w.id
  ),
  ups AS (                                      -- uploads fully inside each item's window
    SELECT w.id AS wid, u.id AS uid, u.date_from, u.date_to FROM win w
    JOIN rista_consumption_uploads u ON u.store_id = p_store_id
     AND u.date_from > w.od AND u.date_to <= w.cd
  ),
  covered AS (
    SELECT wid, SUM(date_to - date_from + 1)::INTEGER AS d FROM ups GROUP BY wid
  ),
  usedq AS (
    SELECT w.id,
           SUM(l.ideal_qty * public.unit_factor(l.unit, w.uom)) AS q,
           bool_or(public.unit_factor(l.unit, w.uom) IS NULL) AS bad_unit,
           MAX(l.rate) FILTER (WHERE l.rate IS NOT NULL) AS r
    FROM win w JOIN ups ON ups.wid = w.id
    JOIN rista_consumption_lines l ON l.upload_id = ups.uid AND l.sku = w.rista_sku
    GROUP BY w.id
  ),
  calc AS (
    SELECT w.*, COALESCE(rec.q, 0) AS rq, COALESCE(wst.q, 0) AS wq, COALESCE(u.q, 0) AS uq,
           COALESCE(u.bad_unit, false) AS bad_unit,
           COALESCE(w.rate, u.r) AS rt,
           COALESCE(public.unit_factor(COALESCE(w.rista_unit, 'nos'), w.uom), 1) AS f,
           (w.cd - w.od)::INTEGER AS d, COALESCE(cv.d, 0) AS dc
    FROM win w
    LEFT JOIN rec ON rec.id = w.id LEFT JOIN wst ON wst.id = w.id
    LEFT JOIN usedq u ON u.id = w.id LEFT JOIN covered cv ON cv.wid = w.id
  )
  SELECT c.id, c.name, c.grp, c.uom, c.rista_unit, c.count_frequency, c.rista_sku, c.rt,
         c.od, c.oq, c.rq, c.wq, ROUND(c.uq, 3),
         ROUND(c.oq + c.rq - c.wq - c.uq, 3) AS system_closing,
         c.cd, c.cq,
         ROUND(c.cq - (c.oq + c.rq - c.wq - c.uq), 3) AS variance,
         CASE WHEN c.uq > 0 THEN ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.uq * 100, 1) END,
         -- ₹: variance is in app unit; rate is per Rista unit
         ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.f * COALESCE(c.rt, 0), 2) AS variance_amount,
         c.d, c.dc,
         (CASE
            WHEN c.rista_sku IS NULL THEN 'NO_SKU'                 -- can't know sales use
            WHEN c.bad_unit THEN 'UNIT_MISMATCH'
            WHEN c.dc < c.d THEN 'SALES_DATA_MISSING'              -- some days have no Rista upload
            WHEN c.oq + c.rq - c.wq - c.uq < 0 THEN 'CHECK_RECEIVED'  -- system stock below zero: delivery not entered?
            WHEN c.cq - (c.oq + c.rq - c.wq - c.uq) < 0 THEN 'SHORT'
            WHEN c.cq - (c.oq + c.rq - c.wq - c.uq) > 0 THEN 'EXCESS'
            ELSE 'OK'
          END)::TEXT
  FROM calc c
  ORDER BY ABS(ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.f * COALESCE(c.rt, 0), 2)) DESC, c.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
