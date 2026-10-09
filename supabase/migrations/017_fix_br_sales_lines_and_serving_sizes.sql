-- =====================================================================
-- 017_fix_br_sales_lines_and_serving_sizes.sql
-- Fixes Baskin Robbins sales detection:
--   1. Normalization with connector word handling (& / and / n)
--   2. Enriched serving size match words (scoop, single, double, packs, ml)
--   3. Aliases in items.rista_names (Vanilla, Banana & Strawberry, etc.)
--   4. Default serving size fallback (Regular Scoop 94g) when flavour is sold
--   5. SECURITY DEFINER on save_sales_items to prevent RLS write blocks
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Improved Normalizer: handles &, and, n, extra punctuation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.br_norm(t TEXT) RETURNS TEXT AS $$
  SELECT ' ' || btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(COALESCE(t, '')), '&', ' and ', 'g'),
        '\s+''?n''?\s+', ' and ', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  ) || ' ';
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 2. Standardize Serving Sizes match_words
-- ---------------------------------------------------------------------
UPDATE br_serving_sizes
SET match_words = 'small, sm, kid, kids, 118ml, 118 ml, small scoop'
WHERE name = 'Small Scoop';

UPDATE br_serving_sizes
SET match_words = 'regular, single, sgl, reg, standard, 180ml, 180 ml, scoop, scoops, single scoop, regular scoop'
WHERE name = 'Regular Scoop';

UPDATE br_serving_sizes
SET match_words = 'double, dbl, two scoop, 2 scoop, 236ml, 236 ml, double scoop'
WHERE name = 'Double Scoop';

UPDATE br_serving_sizes
SET match_words = 'family, fam, 500ml, 500 ml, family pack'
WHERE name = 'Family Pack';

UPDATE br_serving_sizes
SET match_words = 'value, val, 700ml, 700 ml, value pack'
WHERE name = 'Value Pack';

UPDATE br_serving_sizes
SET match_words = 'happiness, happiness pack'
WHERE name = 'Happiness Pack';

UPDATE br_serving_sizes
SET match_words = 'party, 1000ml, 1000 ml, 1ltr, 1 ltr, 1 litre, 1000g, party pack'
WHERE name = 'Party Pack';

-- ---------------------------------------------------------------------
-- 3. Add Common Flavour Aliases in items.rista_names
-- ---------------------------------------------------------------------
UPDATE items SET rista_names = 'Vanilla, Vanilla Ice Cream, Classic Vanilla Scoop'
WHERE name = 'Classic Vanilla' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Banana and Strawberry, Banana & Strawberry, Banana Strawberry'
WHERE name = 'Banana ''N'' Strawberry' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Cookies and Cream, Cookies & Cream'
WHERE name = 'Cookies ''N Cream' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Mango and Cream, Mango & Cream, Mango Cream'
WHERE name = 'Mango & Cream' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Pralines and Cream, Pralines & Cream'
WHERE name = 'Pralines N Cream' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Lotus Biscoff, Biscoff Ice Cream'
WHERE name = 'Biscoff' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items SET rista_names = 'Chocolate and Roasted Hazelnut, Chocolate Roasted Hazelnut'
WHERE name = 'Chocolate & Roasted Hazelnut' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

-- ---------------------------------------------------------------------
-- 4. Robust br_sales_lines: Flavour Detection + Smart Serving Size Fallback
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.br_sales_lines(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.br_sales_lines(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  sales_key TEXT, item_name TEXT, variant TEXT, item_type TEXT, category TEXT, quantity NUMERIC,
  item_id UUID, flavour_name TEXT, size_id UUID, size_name TEXT, grams_each NUMERIC, grams NUMERIC,
  matched_by TEXT
) AS $$
DECLARE v_brand UUID;
BEGIN
  IF current_user <> 'postgres' AND NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
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
  flv_base AS (
    SELECT i.id, i.name::TEXT AS name,
           unnest(string_to_array(i.name || ',' || COALESCE(i.rista_names, '') || 
             CASE 
               WHEN i.name ILIKE 'Classic Vanilla%' THEN ',Vanilla,Vanilla Ice Cream'
               WHEN i.name ILIKE 'Banana%Strawberry%' THEN ',Banana Strawberry'
               WHEN i.name ILIKE '%Biscoff%' THEN ',Lotus Biscoff'
               ELSE '' 
             END, ',')) AS raw_alias,
           (ic.name ILIKE '%gelato%') AS gelato
    FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.brand_id = v_brand AND ic.is_flavour
  ),
  flv AS (
    SELECT id, name, gelato, public.br_norm(raw_alias) AS nn
    FROM flv_base
    WHERE btrim(raw_alias) <> ''
  ),
  sz AS (
    SELECT z.id, z.name, z.grams_ice_cream, z.grams_gelato, z.sort_order,
           public.br_norm(w0.raw) AS word
    FROM br_serving_sizes z
    CROSS JOIN LATERAL unnest(string_to_array(z.match_words || ',' || z.name, ',')) AS w0(raw)
    WHERE z.brand_id = v_brand AND z.is_active AND btrim(w0.raw) <> ''
  ),
  -- Skip words from br_settings (cones, waffles, cake, water, sticks...)
  skip_w AS (
    SELECT string_to_array(COALESCE(s.skip_words, 'cone, waffle, cake, stick, bar, water, soda, dip'), ',') AS raw_words
    FROM br_settings s WHERE s.brand_id = v_brand
  ),
  skip_words AS (
    SELECT public.br_norm(btrim(w.word)) AS word
    FROM skip_w sw
    CROSS JOIN LATERAL unnest(sw.raw_words) AS w(word)
    WHERE btrim(w.word) <> ''
  ),
  line_skipped AS (
    SELECT DISTINCT l.k
    FROM lines l
    JOIN skip_words sw ON position(sw.word IN public.br_norm(l.nm || ' ' || l.vr || ' ' || l.cat)) > 0
  ),
  -- Flavour detection: longest matching alias wins
  auto_flv AS (
    SELECT DISTINCT ON (l.k) l.k, f.id, f.name, f.gelato
    FROM lines l
    JOIN flv f ON position(f.nn IN public.br_norm(l.nm || ' ' || l.vr || ' ' || l.cat)) > 0
    ORDER BY l.k, length(f.nn) DESC
  ),
  -- Size matches in Item Name, Variant, or Category
  line_sz_matches AS (
    SELECT l.k, s.id, s.name, s.sort_order, length(s.word) AS wlen
    FROM lines l
    JOIN sz s ON position(s.word IN public.br_norm(l.nm || ' ' || l.vr || ' ' || l.cat)) > 0
  ),
  auto_sz AS (
    SELECT DISTINCT ON (m.k) m.k, m.id
    FROM line_sz_matches m
    ORDER BY m.k, m.wlen DESC, m.sort_order
  ),
  -- Default size for brand (Regular Scoop) if flavour was found but no specific size keyword in line
  def_sz AS (
    SELECT z.id FROM br_serving_sizes z
    WHERE z.brand_id = v_brand AND z.is_active
    ORDER BY (CASE WHEN z.name ILIKE '%regular%' OR z.name ILIKE '%single%' THEN 0 ELSE 1 END), z.sort_order
    LIMIT 1
  ),
  pick AS (
    SELECT l.*,
           m.is_ignored AS ign,
           (ls.k IS NOT NULL AND m.sales_key IS NULL) AS is_skipped,
           COALESCE(m.item_id, af.id) AS fid,
           COALESCE(
             m.size_id,
             asz.id,
             -- Fall back to Regular Scoop if flavour is detected
             CASE WHEN COALESCE(m.item_id, af.id) IS NOT NULL THEN (SELECT id FROM def_sz) END
           ) AS sid,
           (m.sales_key IS NOT NULL) AS saved,
           (af.id IS NOT NULL) AS has_flv
    FROM lines l
    LEFT JOIN br_sales_map m ON m.brand_id = v_brand AND m.sales_key = l.k
    LEFT JOIN auto_flv af ON af.k = l.k
    LEFT JOIN auto_sz asz ON asz.k = l.k
    LEFT JOIN line_skipped ls ON ls.k = l.k
  )
  SELECT p.k, p.nm, p.vr, p.tp, p.cat, p.q,
         CASE WHEN p.ign OR p.is_skipped THEN NULL ELSE f.id END,
         CASE WHEN p.ign OR p.is_skipped THEN NULL ELSE f.name END,
         CASE WHEN p.ign OR p.is_skipped THEN NULL ELSE z.id END,
         CASE WHEN p.ign OR p.is_skipped THEN NULL ELSE z.name END,
         CASE WHEN p.ign OR p.is_skipped OR f.id IS NULL OR z.id IS NULL THEN NULL
              WHEN f.gelato THEN z.grams_gelato ELSE z.grams_ice_cream END,
         CASE WHEN p.ign OR p.is_skipped OR f.id IS NULL OR z.id IS NULL THEN 0
              ELSE p.q * CASE WHEN f.gelato THEN z.grams_gelato ELSE z.grams_ice_cream END END,
         (CASE WHEN p.ign THEN 'ignored'
               WHEN p.is_skipped THEN 'skipped'
               WHEN f.id IS NULL THEN 'none'
               WHEN p.saved THEN 'saved' ELSE 'auto' END)::TEXT
  FROM pick p
  LEFT JOIN (SELECT DISTINCT id, name, gelato FROM flv) f ON f.id = p.fid
  LEFT JOIN br_serving_sizes z ON z.id = p.sid AND z.is_active
  ORDER BY (CASE WHEN p.ign OR p.is_skipped THEN 2 WHEN f.id IS NULL THEN 0 ELSE 1 END), p.q DESC, p.nm;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 5. save_sales_items: Elevated SECURITY DEFINER with store access check
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_sales_items(p_store_id UUID, p_date DATE, p_net NUMERIC, p_items JSONB)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF current_user <> 'postgres' AND NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to save sales for this store';
  END IF;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 6. br_daily_report: Daily reconciliation per flavour
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
  IF current_user <> 'postgres' AND NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
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
    WHERE ic.brand_id = v_brand AND ic.is_flavour
      AND (
        i.is_active 
        OR EXISTS (
          SELECT 1 FROM br_flavour_counts c 
          WHERE c.item_id = i.id AND c.store_id = p_store_id AND c.count_date = p_date
        )
      )
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
           COALESCE(rec.q, 0) AS r, COALESCE(wst.q, 0) AS w, COALESCE(sold.q, 0) AS s,
           CASE 
             WHEN f.allow > 0 THEN f.allow 
             ELSE ROUND(COALESCE(sold.q, 0) * 0.05) 
           END AS computed_allow
    FROM flv f
    LEFT JOIN op ON op.item_id = f.id LEFT JOIN cl ON cl.item_id = f.id LEFT JOIN pc ON pc.item_id = f.id
    LEFT JOIN rec ON rec.item_id = f.id LEFT JOIN wst ON wst.item_id = f.id LEFT JOIN sold ON sold.item_id = f.id
  )
  SELECT c.id, c.code, c.name, c.rng, c.gelato,
         c.o, c.r, c.c,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c END,
         c.s, c.w,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c - c.s - c.w END,
         c.computed_allow, c.p,
         CASE WHEN c.o IS NOT NULL AND c.p IS NOT NULL THEN c.o - c.p END,
         (CASE
            WHEN c.o IS NULL OR c.c IS NULL THEN 'NOT_COUNTED'
            WHEN NOT v_has_sales THEN 'NO_SALES'
            WHEN c.o + c.r - c.c - c.s - c.w > c.computed_allow THEN 'OVER'
            WHEN c.o + c.r - c.c - c.s - c.w < -c.computed_allow THEN 'CHECK'
            ELSE 'OK'
          END)::TEXT
  FROM calc c
  ORDER BY c.so, c.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

