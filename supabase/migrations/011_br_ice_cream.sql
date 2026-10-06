-- =====================================================================
-- 011_br_ice_cream.sql — Baskin Robbins: ice cream only, per flavour (6 Oct 2026)
-- Run ONCE in Supabase → SQL Editor → Run, BEFORE pushing the code. Safe to re-run.
-- Requires 010.
--
-- Daily, per flavour:
--   used  = opening + received (± transfers) − closing          (all grams)
--   sold  = Rista Sales By Items qty × serving grams             (gelato has its own grams)
--   gap   = used − sold − wasted
--   OVER  if gap >  tasting allowance      (more ice cream gone than sales explain)
--   CHECK if gap < −tasting allowance      (more left than expected: miscount / delivery not entered)
--   OK    otherwise
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Serving sizes (grams editable by Super Admin / Admin with "Allowed to edit")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS br_serving_sizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grams_ice_cream NUMERIC NOT NULL CHECK (grams_ice_cream >= 0),
  grams_gelato NUMERIC NOT NULL CHECK (grams_gelato >= 0),
  match_words TEXT NOT NULL DEFAULT '',     -- comma separated words that identify this size in Rista
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

INSERT INTO br_serving_sizes (brand_id, name, grams_ice_cream, grams_gelato, match_words, sort_order) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Small Scoop',    62,  62,  'small',            1),
  ('22222222-2222-2222-2222-222222222222', 'Regular Scoop',  94,  94,  'regular, single',  2),
  ('22222222-2222-2222-2222-222222222222', 'Double Scoop',   224, 224, 'double',           3),
  ('22222222-2222-2222-2222-222222222222', 'Family Pack',    263, 263, 'family',           4),
  ('22222222-2222-2222-2222-222222222222', 'Value Pack',     368, 368, 'value',            5),
  ('22222222-2222-2222-2222-222222222222', 'Happiness Pack', 525, 525, 'happiness',        6),
  ('22222222-2222-2222-2222-222222222222', 'Party Pack',     575, 695, 'party',            7)
ON CONFLICT (brand_id, name) DO NOTHING;

ALTER TABLE br_serving_sizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Serving sizes readable" ON br_serving_sizes;
CREATE POLICY "Serving sizes readable" ON br_serving_sizes FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Editors manage serving sizes" ON br_serving_sizes;
CREATE POLICY "Editors manage serving sizes" ON br_serving_sizes FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ---------------------------------------------------------------------
-- 2. Tasting allowance per flavour (grams per day)
-- ---------------------------------------------------------------------
ALTER TABLE items ADD COLUMN IF NOT EXISTS tasting_allowance_grams NUMERIC NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 3. Opening + closing weigh per flavour
--    grams = unopened boxes × full box weight + (open box on scale − 100 g)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS br_flavour_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  count_date DATE NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('opening', 'closing')),
  unopened_boxes INTEGER NOT NULL DEFAULT 0 CHECK (unopened_boxes >= 0),
  open_box_gross NUMERIC NOT NULL DEFAULT 0 CHECK (open_box_gross >= 0),
  grams NUMERIC NOT NULL CHECK (grams >= 0),
  staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  submitted_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, item_id, count_date, session)
);
CREATE INDEX IF NOT EXISTS br_flavour_counts_store_date ON br_flavour_counts (store_id, count_date);

ALTER TABLE br_flavour_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View flavour counts" ON br_flavour_counts;
CREATE POLICY "View flavour counts" ON br_flavour_counts FOR SELECT
  USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));
DROP POLICY IF EXISTS "Store writes flavour counts" ON br_flavour_counts;
CREATE POLICY "Store writes flavour counts" ON br_flavour_counts FOR ALL
  USING (public.store_can_write(store_id, count_date)) WITH CHECK (public.store_can_write(store_id, count_date));
DROP POLICY IF EXISTS "Editors manage br_flavour_counts" ON br_flavour_counts;
CREATE POLICY "Editors manage br_flavour_counts" ON br_flavour_counts FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ---------------------------------------------------------------------
-- 4. Rista sales line → flavour + size (saved by the owner on the Flavours page)
--    sales_key = br_sales_key(item name, variant)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS br_sales_map (
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  sales_key TEXT NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  size_id UUID REFERENCES br_serving_sizes(id) ON DELETE CASCADE,
  is_ignored BOOLEAN NOT NULL DEFAULT false,      -- not ice cream (cones, toppings, drinks …)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, sales_key),
  CHECK (is_ignored OR (item_id IS NOT NULL AND size_id IS NOT NULL))
);
ALTER TABLE br_sales_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sales map readable" ON br_sales_map;
CREATE POLICY "Sales map readable" ON br_sales_map FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Editors manage sales map" ON br_sales_map;
CREATE POLICY "Editors manage sales map" ON br_sales_map FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- Lower-case words only, padded with spaces so we can match whole words
CREATE OR REPLACE FUNCTION public.br_norm(t TEXT) RETURNS TEXT AS $$
  SELECT ' ' || btrim(regexp_replace(lower(COALESCE(t, '')), '[^a-z0-9]+', ' ', 'g')) || ' ';
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.br_sales_key(p_name TEXT, p_variant TEXT) RETURNS TEXT AS $$
  SELECT btrim(lower(COALESCE(p_name, '')) || CASE WHEN COALESCE(btrim(p_variant), '') <> '' THEN ' | ' || lower(btrim(p_variant)) ELSE '' END);
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 5. Sales By Items lines for one store/day, each turned into flavour grams
--    match = saved match → else automatic (line names exactly one flavour + one size)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.br_sales_lines(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.br_sales_lines(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  sales_key TEXT, item_name TEXT, variant TEXT, item_type TEXT, category TEXT, quantity NUMERIC,
  item_id UUID, flavour_name TEXT, size_id UUID, size_name TEXT, grams_each NUMERIC, grams NUMERIC,
  matched_by TEXT        -- saved / auto / ignored / none
) AS $$
DECLARE v_brand UUID;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;
  SELECT s.brand_id INTO v_brand FROM stores s WHERE s.id = p_store_id;

  RETURN QUERY
  WITH lines AS (
    SELECT public.br_sales_key(si.item_name, si.variant) AS k,
           MIN(si.item_name)::TEXT AS nm, MIN(COALESCE(si.variant, ''))::TEXT AS vr,
           MIN(COALESCE(si.item_type, 'Item'))::TEXT AS tp, MIN(COALESCE(si.category, ''))::TEXT AS cat,
           SUM(si.quantity_sold)::NUMERIC AS q
    FROM daily_sales_items si
    JOIN daily_sales_summary ss ON ss.id = si.sales_summary_id
    WHERE ss.store_id = p_store_id AND ss.entry_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  flv AS (
    SELECT i.id, i.name::TEXT AS name, public.br_norm(i.name) AS nn,
           (ic.name ILIKE '%gelato%') AS gelato
    FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.brand_id = v_brand AND ic.is_flavour
  ),
  sz AS (
    SELECT z.id, z.name, z.grams_ice_cream, z.grams_gelato, w.word
    FROM br_serving_sizes z
    CROSS JOIN LATERAL unnest(string_to_array(z.match_words || ',' || z.name, ',')) AS w0(raw)
    CROSS JOIN LATERAL (SELECT public.br_norm(w0.raw) AS word) w
    WHERE z.brand_id = v_brand AND z.is_active AND btrim(w.word) <> ''
  ),
  auto_flv AS (                 -- longest flavour name found in the line ("Cotton Candy Burst" beats "Cotton Candy")
    SELECT DISTINCT ON (l.k) l.k, f.id
    FROM lines l JOIN flv f ON position(f.nn IN public.br_norm(l.nm || ' ' || l.vr)) > 0
    ORDER BY l.k, length(f.nn) DESC
  ),
  auto_sz AS (                  -- exactly one size found in the line
    SELECT l.k, MIN(s.id::TEXT)::UUID AS id
    FROM lines l JOIN sz s ON position(s.word IN public.br_norm(l.nm || ' ' || l.vr)) > 0
    GROUP BY l.k HAVING COUNT(DISTINCT s.id) = 1
  ),
  pick AS (
    SELECT l.*,
           m.is_ignored AS ign,
           COALESCE(CASE WHEN m.sales_key IS NOT NULL THEN m.item_id END, CASE WHEN m.sales_key IS NULL THEN af.id END) AS fid,
           COALESCE(CASE WHEN m.sales_key IS NOT NULL THEN m.size_id END, CASE WHEN m.sales_key IS NULL THEN asz.id END) AS sid,
           (m.sales_key IS NOT NULL) AS saved
    FROM lines l
    LEFT JOIN br_sales_map m ON m.brand_id = v_brand AND m.sales_key = l.k
    LEFT JOIN auto_flv af ON af.k = l.k
    LEFT JOIN auto_sz asz ON asz.k = l.k
  )
  SELECT p.k, p.nm, p.vr, p.tp, p.cat, p.q,
         CASE WHEN p.ign THEN NULL ELSE f.id END,
         CASE WHEN p.ign THEN NULL ELSE f.name END,
         CASE WHEN p.ign THEN NULL ELSE z.id END,
         CASE WHEN p.ign THEN NULL ELSE z.name END,
         CASE WHEN p.ign OR f.id IS NULL OR z.id IS NULL THEN NULL
              WHEN f.gelato THEN z.grams_gelato ELSE z.grams_ice_cream END,
         CASE WHEN p.ign OR f.id IS NULL OR z.id IS NULL THEN 0
              ELSE p.q * CASE WHEN f.gelato THEN z.grams_gelato ELSE z.grams_ice_cream END END,
         (CASE WHEN p.ign THEN 'ignored'
               WHEN f.id IS NULL OR z.id IS NULL THEN 'none'
               WHEN p.saved THEN 'saved' ELSE 'auto' END)::TEXT
  FROM pick p
  LEFT JOIN flv f ON f.id = p.fid
  LEFT JOIN br_serving_sizes z ON z.id = p.sid AND z.is_active
  ORDER BY (CASE WHEN p.ign THEN 2 WHEN f.id IS NULL OR z.id IS NULL THEN 0 ELSE 1 END), p.q DESC, p.nm;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 6. Daily report per flavour
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.br_daily_report(UUID, DATE);
CREATE OR REPLACE FUNCTION public.br_daily_report(p_store_id UUID, p_date DATE)
RETURNS TABLE (
  item_id UUID, code TEXT, flavour TEXT, range_name TEXT, is_gelato BOOLEAN,
  opening NUMERIC, received NUMERIC, closing NUMERIC, used NUMERIC,
  sold NUMERIC, wasted NUMERIC, gap NUMERIC, allowance NUMERIC,
  prev_closing NUMERIC, overnight_change NUMERIC, status TEXT
) AS $$
DECLARE v_brand UUID; v_has_sales BOOLEAN;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;
  SELECT s.brand_id INTO v_brand FROM stores s WHERE s.id = p_store_id;
  SELECT EXISTS (
    SELECT 1 FROM daily_sales_items si JOIN daily_sales_summary ss ON ss.id = si.sales_summary_id
    WHERE ss.store_id = p_store_id AND ss.entry_date = p_date
  ) INTO v_has_sales;

  RETURN QUERY
  WITH flv AS (
    SELECT i.id, i.code::TEXT AS code, i.name::TEXT AS name, ic.name::TEXT AS rng,
           (ic.name ILIKE '%gelato%') AS gelato, COALESCE(i.tasting_allowance_grams, 0) AS allow, ic.sort_order AS so
    FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.brand_id = v_brand AND ic.is_flavour AND i.is_active
  ),
  op AS (SELECT c.item_id, c.grams FROM br_flavour_counts c WHERE c.store_id = p_store_id AND c.count_date = p_date AND c.session = 'opening'),
  cl AS (SELECT c.item_id, c.grams FROM br_flavour_counts c WHERE c.store_id = p_store_id AND c.count_date = p_date AND c.session = 'closing'),
  pc AS (SELECT c.item_id, c.grams FROM br_flavour_counts c WHERE c.store_id = p_store_id AND c.count_date = p_date - 1 AND c.session = 'closing'),
  rec AS (
    SELECT po.item_id, SUM(CASE WHEN po.movement = 'transfer_out' THEN -po.quantity ELSE po.quantity END) AS q
    FROM purchase_orders po WHERE po.store_id = p_store_id AND po.entry_date = p_date GROUP BY po.item_id
  ),
  wst AS (
    SELECT dw.item_id, SUM(dw.quantity_wasted) AS q
    FROM daily_wastage_log dw WHERE dw.store_id = p_store_id AND dw.entry_date = p_date GROUP BY dw.item_id
  ),
  sold AS (
    SELECT l.item_id, SUM(l.grams) AS q FROM public.br_sales_lines(p_store_id, p_date, p_date) l
    WHERE l.item_id IS NOT NULL GROUP BY l.item_id
  ),
  calc AS (
    SELECT f.*, op.grams AS o, cl.grams AS c, pc.grams AS p,
           COALESCE(rec.q, 0) AS r, COALESCE(wst.q, 0) AS w, COALESCE(sold.q, 0) AS s
    FROM flv f
    LEFT JOIN op ON op.item_id = f.id LEFT JOIN cl ON cl.item_id = f.id LEFT JOIN pc ON pc.item_id = f.id
    LEFT JOIN rec ON rec.item_id = f.id LEFT JOIN wst ON wst.item_id = f.id LEFT JOIN sold ON sold.item_id = f.id
  )
  SELECT c.id, c.code, c.name, c.rng, c.gelato,
         c.o, c.r, c.c,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c END,
         c.s, c.w,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c - c.s - c.w END,
         c.allow, c.p,
         CASE WHEN c.o IS NOT NULL AND c.p IS NOT NULL THEN c.o - c.p END,
         (CASE
            WHEN c.o IS NULL OR c.c IS NULL THEN 'NOT_COUNTED'
            WHEN NOT v_has_sales THEN 'NO_SALES'
            WHEN c.o + c.r - c.c - c.s - c.w > c.allow THEN 'OVER'
            WHEN c.o + c.r - c.c - c.s - c.w < -c.allow THEN 'CHECK'
            ELSE 'OK'
          END)::TEXT
  FROM calc c
  ORDER BY c.so, c.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 7. Baskin Robbins: nothing else is counted (no cups, spoons …) — only flavours, on their own screen
-- ---------------------------------------------------------------------
UPDATE items i SET count_frequency = 'none'
FROM item_categories ic
WHERE ic.id = i.category_id AND ic.brand_id = '22222222-2222-2222-2222-222222222222';
