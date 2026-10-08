-- =====================================================================
-- 016_master_latest_updates.sql
-- Consolidated master migration for:
--   1. BR Settings (skip words for POS items)
--   2. Bulk Weights (2250g) and Box Tare (130g)
--   3. Daily Cash Expenses & Bank Deposits (tea, store supplies, bank deposits)
--   4. BR Daily Reconciliation with Historical Preservation & 5% Tasting Allowance
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BR Settings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS br_settings (
  brand_id UUID PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  skip_words TEXT NOT NULL DEFAULT 'cone, waffle, cake, stick, bar, water, soda, dip',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE br_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings readable" ON br_settings;
CREATE POLICY "Settings readable" ON br_settings FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Editors manage br_settings" ON br_settings;
CREATE POLICY "Editors manage br_settings" ON br_settings FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

INSERT INTO br_settings (brand_id, skip_words)
VALUES ('22222222-2222-2222-2222-222222222222', 'cone, waffle, cake, stick, bar, water, soda, dip')
ON CONFLICT (brand_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Standardize BR Bulk Weights (2250g) & Tare (130g)
-- ---------------------------------------------------------------------
UPDATE items
SET full_box_grams = 2250
WHERE category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

UPDATE items
SET tare_grams = 130
WHERE category_id IN (SELECT id FROM item_categories WHERE is_flavour = true);

-- ---------------------------------------------------------------------
-- 3. Daily Cash Transactions (Expenses like tea/supplies & Bank Deposits)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('expense', 'bank_deposit')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  description TEXT,
  staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_tx_store_date ON daily_cash_transactions(store_id, entry_date);

ALTER TABLE daily_cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View cash transactions for accessed stores" ON daily_cash_transactions;
CREATE POLICY "View cash transactions for accessed stores" ON daily_cash_transactions
  FOR SELECT USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));

DROP POLICY IF EXISTS "Manage cash transactions for accessed stores" ON daily_cash_transactions;
CREATE POLICY "Manage cash transactions for accessed stores" ON daily_cash_transactions
  FOR ALL USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));

-- ---------------------------------------------------------------------
-- 4. Baskin Robbins Daily Report Function
--    - Preserves deactivated flavours if counted historically
--    - 5% Tasting Allowance calculated proportional to sold grams
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
           -- 5% tasting allowance of sold grams (or custom allowance if explicitly configured on flavour)
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
