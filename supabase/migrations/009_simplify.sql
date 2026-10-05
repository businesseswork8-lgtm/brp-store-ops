-- =====================================================================
-- 009_simplify.sql — one stock system for all stores (5 Oct 2026)
-- Run ONCE in Supabase → SQL Editor → Run, BEFORE pushing the code. Safe to re-run.
-- Requires 008_stock_control.sql.
-- Old tables (daily_stock_entries, recipes, variance_thresholds …) are kept for history; nothing is deleted.
-- =====================================================================

-- Ice cream boxes in the new Stock Count (for checking a count later)
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS unopened_boxes INTEGER;
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS open_box_gross NUMERIC;

-- Everything staff counted every day before is counted daily in the new Stock Count
UPDATE items SET count_frequency = 'daily'
WHERE is_active AND is_daily_tracked AND count_frequency = 'none';

-- Ice cream flavours: Rista uses kg
UPDATE items i SET rista_unit = 'kg'
FROM item_categories ic
WHERE ic.id = i.category_id AND ic.is_flavour AND i.rista_unit IS NULL;
