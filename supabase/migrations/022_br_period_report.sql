-- =============================================================================
-- Migration 022: Multi-Day Period Reconciliation Report (br_period_report)
-- 
-- Allows comparing starting stock, inward bulk received, POS sales, and wastage
-- across 7 days, 15 days, 30 days (monthly), or custom date ranges.
-- =============================================================================

DROP FUNCTION IF EXISTS public.br_period_report(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.br_period_report(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  item_id UUID, code TEXT, flavour TEXT, range_name TEXT, is_gelato BOOLEAN,
  opening NUMERIC, opening_date DATE, opening_session TEXT,
  received NUMERIC, received_boxes NUMERIC,
  closing NUMERIC, closing_date DATE, closing_session TEXT,
  used NUMERIC, sold NUMERIC, wasted NUMERIC, expected_closing NUMERIC,
  gap NUMERIC, allowance NUMERIC, status TEXT
) AS $$
DECLARE
  v_brand UUID;
  v_has_sales BOOLEAN;
  v_days INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;

  SELECT s.brand_id INTO v_brand FROM stores s WHERE s.id = p_store_id;
  v_days := GREATEST(1, (p_to - p_from + 1));

  SELECT EXISTS (
    SELECT 1 FROM daily_sales_items si
    JOIN daily_sales_summary ss ON ss.id = si.sales_summary_id
    WHERE ss.store_id = p_store_id AND ss.entry_date BETWEEN p_from AND p_to
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
          WHERE c.item_id = i.id AND c.store_id = p_store_id AND c.count_date BETWEEN p_from AND p_to
        )
      )
  ),
  -- Start count: prioritize opening on p_from, then closing on p_from - 1, then closing on p_from, then earliest
  op_raw AS (
    SELECT DISTINCT ON (c.item_id)
      c.item_id, c.grams, c.count_date, c.session::TEXT AS session
    FROM br_flavour_counts c
    WHERE c.store_id = p_store_id AND c.count_date >= p_from - 2 AND c.count_date <= p_to
    ORDER BY c.item_id,
             (CASE
                WHEN c.count_date = p_from AND c.session = 'opening' THEN 1
                WHEN c.count_date = p_from - 1 AND c.session = 'closing' THEN 2
                WHEN c.count_date = p_from AND c.session = 'closing' THEN 3
                WHEN c.count_date >= p_from THEN 4
                ELSE 5
              END),
             c.count_date ASC
  ),
  -- End count: prioritize closing on p_to, then opening on p_to, then latest on or before p_to
  cl_raw AS (
    SELECT DISTINCT ON (c.item_id)
      c.item_id, c.grams, c.count_date, c.session::TEXT AS session
    FROM br_flavour_counts c
    WHERE c.store_id = p_store_id AND c.count_date <= p_to
    ORDER BY c.item_id,
             (CASE
                WHEN c.count_date = p_to AND c.session = 'closing' THEN 1
                WHEN c.count_date = p_to AND c.session = 'opening' THEN 2
                ELSE 3
              END),
             c.count_date DESC
  ),
  rec AS (
    SELECT po.item_id,
           SUM(CASE WHEN po.movement = 'transfer_out' THEN -po.quantity ELSE po.quantity END) AS q,
           SUM(CASE WHEN po.movement = 'transfer_out' THEN -COALESCE(po.boxes, 0) ELSE COALESCE(po.boxes, 0) END) AS b
    FROM purchase_orders po
    WHERE po.store_id = p_store_id AND po.entry_date BETWEEN p_from AND p_to
    GROUP BY po.item_id
  ),
  wst AS (
    SELECT dw.item_id, SUM(dw.quantity_wasted) AS q
    FROM daily_wastage_log dw
    WHERE dw.store_id = p_store_id AND dw.entry_date BETWEEN p_from AND p_to
    GROUP BY dw.item_id
  ),
  sold AS (
    SELECT l.item_id, SUM(l.grams) AS q
    FROM public.br_sales_lines(p_store_id, p_from, p_to) l
    WHERE l.item_id IS NOT NULL
    GROUP BY l.item_id
  ),
  calc AS (
    SELECT f.*,
           op.grams AS o, op.count_date AS od, op.session AS os,
           cl.grams AS c, cl.count_date AS cd, cl.session AS cs,
           COALESCE(rec.q, 0) AS r, COALESCE(rec.b, 0) AS rb,
           COALESCE(wst.q, 0) AS w,
           COALESCE(sold.q, 0) AS s,
           CASE 
             WHEN f.allow > 0 THEN f.allow * v_days
             ELSE ROUND(COALESCE(sold.q, 0) * 0.05) 
           END AS computed_allow
    FROM flv f
    LEFT JOIN op_raw op ON op.item_id = f.id
    LEFT JOIN cl_raw cl ON cl.item_id = f.id
    LEFT JOIN rec ON rec.item_id = f.id
    LEFT JOIN wst ON wst.item_id = f.id
    LEFT JOIN sold ON sold.item_id = f.id
  )
  SELECT c.id, c.code, c.name, c.rng, c.gelato,
         c.o, c.od, c.os,
         c.r, c.rb,
         c.c, c.cd, c.cs,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c END,
         c.s, c.w,
         CASE WHEN c.o IS NOT NULL THEN c.o + c.r - c.s - c.w END,
         CASE WHEN c.o IS NOT NULL AND c.c IS NOT NULL THEN c.o + c.r - c.c - c.s - c.w END,
         c.computed_allow,
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
