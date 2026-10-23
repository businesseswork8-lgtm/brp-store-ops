-- =====================================================================
-- 023_milkshake_waffle_scoops.sql
-- Baskin Robbins: sales lines that use tub ice cream but were counted as 0 g.
--
--   * Any "<flavour> Milkshake"  -> 1 regular scoop = 95 g of that flavour
--   * Any waffle with a flavour in its name (not "Waffle Cone") -> 40 g of that flavour
--
-- The grams live in br_serving_sizes ("Milkshake Scoop", "Waffle Scoop") so they can be
-- changed any time on  Super Admin > Ice Cream Setup > Scoop & pack grams.
-- Safe to run more than once.
-- =====================================================================

-- 1. The two new "sizes"
INSERT INTO br_serving_sizes (brand_id, name, grams_ice_cream, grams_gelato, match_words, sort_order, is_active) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Milkshake Scoop', 95, 95, 'milkshake', 8, true),
  ('22222222-2222-2222-2222-222222222222', 'Waffle Scoop',    40, 40, 'waffle',    9, true)
ON CONFLICT (brand_id, name) DO UPDATE
  SET grams_ice_cream = EXCLUDED.grams_ice_cream,
      grams_gelato    = EXCLUDED.grams_gelato,
      match_words     = EXCLUDED.match_words,
      is_active       = true;

-- 2. Milkshakes had been set to "ignored" on the matching screen, which overrides everything.
--    Remove those ignore rows so milkshakes count again.
DELETE FROM br_sales_map WHERE is_ignored AND sales_key ILIKE '%milkshake%';

-- 3. Names Rista uses that do not contain the flavour name exactly (only filled when still blank)
UPDATE items SET rista_names = 'Hazelnut Gelato, Hazelnut Chocolate'
 WHERE name = 'Chocolate & Roasted Hazelnut' AND COALESCE(rista_names, '') = ''
   AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);
UPDATE items SET rista_names = 'Bavarian Ice Cream'
 WHERE name = 'Bavarian Chocolate' AND COALESCE(rista_names, '') = ''
   AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);

-- 4. Size detection: milkshakes and waffles come BEFORE the "not from the tub" rules
CREATE OR REPLACE FUNCTION public.br_line_size(p_text TEXT) RETURNS TEXT AS $$
DECLARE t TEXT := public.br_norm2(p_text);
BEGIN
  -- Milkshake = one regular scoop of the flavour
  IF t LIKE '% milkshake %' OR t LIKE '% shake %' THEN
    RETURN 'Milkshake Scoop';
  END IF;
  -- Waffle with ice cream (a waffle CONE is only the cone: skipped below)
  IF t LIKE '% waffle %' AND t NOT LIKE '% cone %' THEN
    RETURN 'Waffle Scoop';
  END IF;
  -- Sundae made to order (not a prepacked cup) = one regular scoop of the flavour in brackets
  IF t LIKE '% sundae %' AND t NOT LIKE '% cup %' AND t NOT LIKE '% prepack %' THEN
    RETURN 'Regular Scoop';
  END IF;
  -- Not scooped from the bulk tub
  IF t LIKE '%@%' OR t LIKE '% factory %' OR t LIKE '% sealed %' OR t LIKE '% prepack %'
     OR t LIKE '% pre pack %' OR t LIKE '% cup %' OR t LIKE '% stick %' OR t LIKE '% bar %'
     OR t LIKE '% cake %' OR t LIKE '% slice %' OR t LIKE '% cone %' OR t LIKE '% waffle %'
     OR t LIKE '% brownie %' OR t LIKE '% sprinkle %' OR t LIKE '% water %'
     OR (t LIKE '% chip %' AND t NOT LIKE '% scoop %' AND t NOT LIKE '% ml %')
  THEN
    RETURN 'SKIP';
  END IF;
  IF t LIKE '% small %'   THEN RETURN 'Small Scoop';   END IF;
  IF t LIKE '% double %'  THEN RETURN 'Double Scoop';  END IF;
  IF t LIKE '% regular %' OR t LIKE '% single %' THEN RETURN 'Regular Scoop'; END IF;
  IF t LIKE '% 1000 ml %' OR t LIKE '% 1000ml %' OR t LIKE '% party %' THEN RETURN 'Party Pack'; END IF;
  IF t LIKE '% 700 ml %'  OR t LIKE '% 700ml %'  OR t LIKE '% value %' THEN RETURN 'Value Pack'; END IF;
  IF t LIKE '% 500 ml %'  OR t LIKE '% 500ml %'  OR t LIKE '% family %' THEN RETURN 'Family Pack'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 5. br_sales_lines: same as migration 018, except a waffle whose flavour is not recognised is
--    quietly skipped (plain waffles are not ice cream) instead of showing as "unmatched".
DROP FUNCTION IF EXISTS public.br_sales_lines(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.br_sales_lines(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  sales_key TEXT, item_name TEXT, variant TEXT, item_type TEXT, category TEXT, quantity NUMERIC,
  item_id UUID, flavour_name TEXT, size_id UUID, size_name TEXT, grams_each NUMERIC, grams NUMERIC,
  matched_by TEXT
) AS $$
DECLARE v_brand UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
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
    SELECT DISTINCT i.id, i.name::TEXT AS name, (ic.name ILIKE '%gelato%') AS gelato,
           public.br_norm2(a.alias) AS nn
    FROM items i
    JOIN item_categories ic ON ic.id = i.category_id
    CROSS JOIN LATERAL unnest(string_to_array(i.name || ',' || COALESCE(i.rista_names, ''), ',')) AS a(alias)
    WHERE ic.brand_id = v_brand AND ic.is_flavour AND btrim(a.alias) <> ''
  ),
  auto AS (
    SELECT l.k,
           public.br_line_size(l.nm || ' ' || l.vr || ' ' || l.cat) AS sz_name,
           (SELECT f.id FROM flv f
             WHERE position(f.nn IN public.br_norm2(l.nm || ' ' || l.vr)) > 0
             ORDER BY length(f.nn) DESC LIMIT 1) AS fid
    FROM lines l
  ),
  pick AS (
    SELECT l.*, a.sz_name, m.sales_key IS NOT NULL AS saved, COALESCE(m.is_ignored, false) AS ign,
           CASE WHEN m.sales_key IS NOT NULL THEN m.item_id ELSE a.fid END AS fid,
           CASE WHEN m.sales_key IS NOT NULL THEN m.size_id
                ELSE (SELECT z.id FROM br_serving_sizes z
                      WHERE z.brand_id = v_brand AND z.is_active AND z.name = a.sz_name LIMIT 1) END AS sid
    FROM lines l
    JOIN auto a ON a.k = l.k
    LEFT JOIN br_sales_map m ON m.brand_id = v_brand AND m.sales_key = l.k
  ),
  res AS (
    SELECT p.*, f.name AS fname, f.gelato, z.name AS zname,
           CASE WHEN f.gelato THEN z.grams_gelato ELSE z.grams_ice_cream END AS each_g,
           (CASE
              WHEN p.ign THEN 'ignored'
              WHEN p.saved THEN 'saved'
              WHEN p.sz_name = 'SKIP' THEN 'skipped'
              WHEN p.fid IS NULL AND p.sz_name IS NULL THEN 'skipped'      -- brownies, cakes, toppings etc.
              WHEN p.fid IS NULL AND p.sz_name = 'Waffle Scoop' THEN 'skipped'  -- waffle without ice cream flavour
              WHEN p.fid IS NULL THEN 'no_flavour'                        -- scoop/pack/shake but flavour not recognised
              WHEN p.sid IS NULL THEN 'none'                              -- flavour but size not recognised
              ELSE 'auto'
            END)::TEXT AS mb
    FROM pick p
    LEFT JOIN (SELECT DISTINCT flv.id, flv.name, flv.gelato FROM flv) f ON f.id = p.fid
    LEFT JOIN br_serving_sizes z ON z.id = p.sid
  )
  SELECT r.k, r.nm, r.vr, r.tp, r.cat, r.q,
         CASE WHEN r.mb IN ('auto', 'saved', 'none') THEN r.fid END,
         CASE WHEN r.mb IN ('auto', 'saved', 'none') THEN r.fname END,
         CASE WHEN r.mb IN ('auto', 'saved') THEN r.sid END,
         CASE WHEN r.mb IN ('auto', 'saved') THEN r.zname END,
         CASE WHEN r.mb IN ('auto', 'saved') THEN r.each_g END,
         CASE WHEN r.mb IN ('auto', 'saved') AND r.each_g IS NOT NULL THEN r.q * r.each_g ELSE 0 END,
         r.mb
  FROM res r
  ORDER BY (CASE r.mb WHEN 'none' THEN 0 WHEN 'no_flavour' THEN 0 WHEN 'auto' THEN 1 WHEN 'saved' THEN 1 ELSE 2 END), r.q DESC, r.nm;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
