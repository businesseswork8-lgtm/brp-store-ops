-- =====================================================================
-- 015_br_daily_report_history.sql — Preserve historical flavour reports
-- Ensures deactivated flavours still appear on past dates when they had counts
-- =====================================================================

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
