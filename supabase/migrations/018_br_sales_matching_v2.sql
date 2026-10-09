-- =====================================================================
-- 018_br_sales_matching_v2.sql
-- Baskin Robbins: Sales By Items -> flavour grams (rewritten from the REAL
-- Rista export "Borivali Chamunda circle - Sales By Items").
--
-- How Rista lists BR sales (one row = flavour + size together):
--   Item Name  = "Mississippi Mud Ice Cream (Double Scoop 124 gm)"
--   Variant(s) = "Double Scoop 124 gm"
--   Item Name  = "Banana 'N Strawberry Ice Cream (Tub) (Hand scooped 500 ml - serves 4-5)"
--   Item Name  = "Mississpie Mud 700 ml@575"            -> factory prepack (NOT from tub)
--   Item Name  = "... (Factory sealed 450 ml ...)"       -> factory pack   (NOT from tub)
--
-- Rules (in this order):
--   1. Saved manual match on the Flavours page always wins.
--   2. Not from the tub -> 'skipped': factory sealed, prepack, "@price" packs,
--      sundae cups, sticks/bars, cakes, cones, toppings, water, brownies.
--   3. Size from the text: small / regular / double / 500 ml|family /
--      700 ml|value / 1000 ml|party. Sundaes with a flavour = 1 regular scoop.
--   4. Flavour = longest flavour name (or alias) found as whole words.
--      Plurals and 'N / & / and are normalised ("Banana 'N Strawberries").
--   5. Grams = qty x official menu weight (ice cream vs gelato).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Official menu weights (BR menu card: Ice cream / Gelato)
--    Small 62/82, Regular 95/125, Double 124/164,
--    Family 500 ml 263/340, Value 700 ml 368/487, Party 1000 ml 525/695
-- ---------------------------------------------------------------------
UPDATE br_serving_sizes SET grams_ice_cream = 62,  grams_gelato = 82,  match_words = 'small',               sort_order = 1, is_active = true WHERE name = 'Small Scoop';
UPDATE br_serving_sizes SET grams_ice_cream = 95,  grams_gelato = 125, match_words = 'regular, single',     sort_order = 2, is_active = true WHERE name = 'Regular Scoop';
UPDATE br_serving_sizes SET grams_ice_cream = 124, grams_gelato = 164, match_words = 'double',              sort_order = 3, is_active = true WHERE name = 'Double Scoop';
UPDATE br_serving_sizes SET grams_ice_cream = 263, grams_gelato = 340, match_words = 'family, 500 ml',      sort_order = 4, is_active = true WHERE name = 'Family Pack';
UPDATE br_serving_sizes SET grams_ice_cream = 368, grams_gelato = 487, match_words = 'value, 700 ml',       sort_order = 5, is_active = true WHERE name = 'Value Pack';
UPDATE br_serving_sizes SET grams_ice_cream = 525, grams_gelato = 695, match_words = 'party, 1000 ml',      sort_order = 7, is_active = true WHERE name = 'Party Pack';

-- ---------------------------------------------------------------------
-- 2. Flavour aliases seen in Rista (comma separated, matched as whole words)
-- ---------------------------------------------------------------------
UPDATE items SET rista_names = 'Vanilla'                    WHERE name = 'Classic Vanilla'         AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);
UPDATE items SET rista_names = 'Lotus Biscoff'              WHERE name = 'Biscoff'                 AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);
UPDATE items SET rista_names = 'Cookie Dough Choco Chip'    WHERE name = 'Choco Chip Cookie Dough' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);
UPDATE items SET rista_names = 'Mint Chocolate Chip'        WHERE name = 'Mint Milk Chocolate Chip' AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);
UPDATE items SET rista_names = ''
  WHERE name IN ('Banana ''N'' Strawberry', 'Cookies ''N Cream', 'Mango & Cream', 'Pralines N Cream', 'Chocolate & Roasted Hazelnut')
    AND category_id IN (SELECT id FROM item_categories WHERE is_flavour);

-- ---------------------------------------------------------------------
-- 3. Normaliser: lower case, & / and / 'n' -> n, plurals -> singular,
--    padded with spaces so we only ever match whole words.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.br_norm2(t TEXT) RETURNS TEXT AS $$
  SELECT ' ' || COALESCE(string_agg(
           CASE
             WHEN w = 'and' THEN 'n'
             WHEN length(w) > 4 AND w ~ 'ies$' THEN regexp_replace(w, 'ies$', 'y')
             WHEN length(w) > 3 AND w ~ '[^s]s$' THEN regexp_replace(w, 's$', '')
             ELSE w
           END, ' ' ORDER BY i), '') || ' '
  FROM unnest(regexp_split_to_array(
         btrim(regexp_replace(
           replace(replace(lower(COALESCE(t, '')), '&', ' and '), '''', ''),
           '[^a-z0-9@]+', ' ', 'g')),
         ' ')) WITH ORDINALITY AS x(w, i)
  WHERE w <> '';
$$ LANGUAGE sql IMMUTABLE;

-- Size of one sales line: returns a br_serving_sizes.name, 'SKIP' (not from tub) or NULL (unknown)
CREATE OR REPLACE FUNCTION public.br_line_size(p_text TEXT) RETURNS TEXT AS $$
DECLARE t TEXT := public.br_norm2(p_text);
BEGIN
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

-- ---------------------------------------------------------------------
-- 4. br_sales_lines: every Sales By Items line -> flavour + size + grams
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
              WHEN p.fid IS NULL THEN 'no_flavour'                        -- scoop/pack but flavour not recognised
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
