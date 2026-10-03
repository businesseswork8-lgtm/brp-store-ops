-- Migration 002: Seed Item Categories, Items, Recipes, and Variance RPC Function

-- 1. Seed Item Categories
INSERT INTO item_categories (id, brand_id, name, sort_order) VALUES
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Batter', 1),
  ('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Filling', 2),
  ('c3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Topping', 3),
  ('c4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Spread', 4),
  ('c5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Packaging', 5),
  ('c6666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Ice Cream', 1)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Tracked Raw Material Items
INSERT INTO items (id, category_id, name, uom, purchase_unit_name, purchase_unit_qty, is_daily_tracked, is_active) VALUES
  -- 99 Pancakes Items
  ('i0010000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'Miracle Mix Batter', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000002', 'c2222222-2222-2222-2222-222222222222', 'Dark Chocolate Filling', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000003', 'c2222222-2222-2222-2222-222222222222', 'Milk Chocolate Filling', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000004', 'c2222222-2222-2222-2222-222222222222', 'White Chocolate Filling', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000005', 'c4444444-4444-4444-4444-444444444444', 'Nutella', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000006', 'c4444444-4444-4444-4444-444444444444', 'Lotus Biscoff Spread', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000007', 'c4444444-4444-4444-4444-444444444444', 'Maple Syrup', 'grams', 'Bottle', 1, true, true),
  ('i0010000-0000-0000-0000-000000000008', 'c2222222-2222-2222-2222-222222222222', 'Caramel Sauce', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000009', 'c3333333-3333-3333-3333-333333333333', 'Whip Cream', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000010', 'c3333333-3333-3333-3333-333333333333', 'Icing Sugar', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000011', 'c3333333-3333-3333-3333-333333333333', 'Brownie Brittle Chips', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000012', 'c3333333-3333-3333-3333-333333333333', 'Brownie Slab', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000013', 'c3333333-3333-3333-3333-333333333333', 'Almond Flakes', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000014', 'c3333333-3333-3333-3333-333333333333', 'Kitkat Bites', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000015', 'c3333333-3333-3333-3333-333333333333', 'Oreo Crushed', 'pieces', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000016', 'c3333333-3333-3333-3333-333333333333', 'Crunchy Bubblegum', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000017', 'c2222222-2222-2222-2222-222222222222', 'Strawberry Compote', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000018', 'c2222222-2222-2222-2222-222222222222', 'Pistachio Filling', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000019', 'c3333333-3333-3333-3333-333333333333', 'Kunafa Vermicelli', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000020', 'c1111111-1111-1111-1111-111111111111', 'Red Velvet Batter', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000021', 'c2222222-2222-2222-2222-222222222222', 'Cream Cheese', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000022', 'c3333333-3333-3333-3333-333333333333', 'Red Velvet Cookies', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000023', 'c3333333-3333-3333-3333-333333333333', 'Cheese Cake Crumble', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000024', 'c2222222-2222-2222-2222-222222222222', 'Almond Chocolate Filling', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000025', 'c3333333-3333-3333-3333-333333333333', 'Fruit Pebbles', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000026', 'c3333333-3333-3333-3333-333333333333', 'Gems', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000027', 'c3333333-3333-3333-3333-333333333333', 'Rainbow Sprinklers', 'grams', 'Packet', 1, true, true),
  ('i0010000-0000-0000-0000-000000000028', 'c3333333-3333-3333-3333-333333333333', 'Choco Chips', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000029', 'c3333333-3333-3333-3333-333333333333', 'Rice Crispies', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000030', 'c3333333-3333-3333-3333-333333333333', 'Caramel Balls', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000031', 'c2222222-2222-2222-2222-222222222222', 'Vanilla Cream Mix', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000032', 'c3333333-3333-3333-3333-333333333333', 'Banana', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000033', 'c3333333-3333-3333-3333-333333333333', 'Chip Sprinklers Dark', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000034', 'c3333333-3333-3333-3333-333333333333', 'Chip Sprinklers White', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000035', 'c3333333-3333-3333-3333-333333333333', 'Cinnamon Icing Sugar', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000036', 'c4444444-4444-4444-4444-444444444444', 'Nutralite Butter', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000037', 'c3333333-3333-3333-3333-333333333333', 'Dark Rice Crispy', 'grams', 'Kg', 1, true, true),
  ('i0010000-0000-0000-0000-000000000038', 'c3333333-3333-3333-3333-333333333333', 'Vanilla Frosting', 'grams', 'Kg', 1, true, true),
  
  -- Baskin Robbins Item
  ('i0020000-0000-0000-0000-000000000001', 'c6666666-6666-6666-6666-666666666666', 'Ice Cream Base', 'grams', 'Tub', 1, true, true)
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Sample Recipes for 99 Pancakes & Baskin Robbins
INSERT INTO recipes (id, brand_id, product_name, product_category) VALUES
  ('r0010000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Holla Nutella 12pc', 'Holland Pancakes'),
  ('r0010000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Holla Nutella 6pc', 'Holland Pancakes'),
  ('r0010000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Brownie Brittle Pancake 12pc', 'Holland Pancakes'),
  ('r0010000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Kitkat Waffle', 'Waffles'),
  ('r0020000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Single Scoop', 'Scoops')
ON CONFLICT (id) DO NOTHING;

-- Ingredients for Sample Recipes
INSERT INTO recipe_ingredients (id, recipe_id, item_id, quantity) VALUES
  ('ri010000-0000-0000-0000-000000000001', 'r0010000-0000-0000-0000-000000000001', 'i0010000-0000-0000-0000-000000000001', 110.0), -- Batter
  ('ri010000-0000-0000-0000-000000000002', 'r0010000-0000-0000-0000-000000000001', 'i0010000-0000-0000-0000-000000000005', 50.0),  -- Nutella
  ('ri010000-0000-0000-0000-000000000003', 'r0010000-0000-0000-0000-000000000001', 'i0010000-0000-0000-0000-000000000010', 1.0),   -- Icing Sugar

  ('ri020000-0000-0000-0000-000000000001', 'r0010000-0000-0000-0000-000000000002', 'i0010000-0000-0000-0000-000000000001', 55.0),  -- Batter
  ('ri020000-0000-0000-0000-000000000002', 'r0010000-0000-0000-0000-000000000002', 'i0010000-0000-0000-0000-000000000005', 25.0),  -- Nutella
  ('ri020000-0000-0000-0000-000000000003', 'r0010000-0000-0000-0000-000000000002', 'i0010000-0000-0000-0000-000000000010', 0.5),  -- Icing Sugar

  ('ri030000-0000-0000-0000-000000000001', 'r0010000-0000-0000-0000-000000000003', 'i0010000-0000-0000-0000-000000000001', 110.0), -- Batter
  ('ri030000-0000-0000-0000-000000000002', 'r0010000-0000-0000-0000-000000000003', 'i0010000-0000-0000-0000-000000000011', 20.0),  -- Brownie Brittle Chips
  ('ri030000-0000-0000-0000-000000000003', 'r0010000-0000-0000-0000-000000000003', 'i0010000-0000-0000-0000-000000000003', 30.0),  -- Milk Chocolate Filling

  ('ri040000-0000-0000-0000-000000000001', 'r0010000-0000-0000-0000-000000000004', 'i0010000-0000-0000-0000-000000000001', 37.5),  -- Batter
  ('ri040000-0000-0000-0000-000000000002', 'r0010000-0000-0000-0000-000000000004', 'i0010000-0000-0000-0000-000000000002', 12.5),  -- Dark Chocolate
  ('ri040000-0000-0000-0000-000000000003', 'r0010000-0000-0000-0000-000000000004', 'i0010000-0000-0000-0000-000000000014', 7.5),   -- Kitkat Bites

  ('ri050000-0000-0000-0000-000000000001', 'r0020000-0000-0000-0000-000000000001', 'i0020000-0000-0000-0000-000000000001', 125.0)  -- Ice Cream Base
ON CONFLICT (id) DO NOTHING;

-- 4. RPC Function to Calculate Daily Stock Variance
CREATE OR REPLACE FUNCTION public.calculate_daily_variance(p_store_id UUID, p_date DATE)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  category_name TEXT,
  uom TEXT,
  opening_stock NUMERIC,
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
BEGIN
  RETURN QUERY
  WITH stock AS (
    SELECT dse.item_id, 
           COALESCE(dse.opening_stock, 0) as opening_stock, 
           COALESCE(dse.closing_stock, 0) as closing_stock,
           (COALESCE(dse.opening_stock, 0) - COALESCE(dse.closing_stock, 0)) as actual_used
    FROM daily_stock_entries dse
    WHERE dse.store_id = p_store_id AND dse.entry_date = p_date
  ),
  theoretical AS (
    SELECT ri.item_id,
           COALESCE(SUM(dsi.quantity_sold * ri.quantity), 0) as theo_consumption
    FROM daily_sales_summary dss
    JOIN daily_sales_items dsi ON dsi.sales_summary_id = dss.id
    JOIN recipes r ON LOWER(TRIM(r.product_name)) = LOWER(TRIM(dsi.item_name))
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE dss.store_id = p_store_id AND dss.entry_date = p_date
    GROUP BY ri.item_id
  ),
  waste AS (
    SELECT dwl.item_id, COALESCE(SUM(dwl.quantity_wasted), 0) as total_wastage
    FROM daily_wastage_log dwl
    WHERE dwl.store_id = p_store_id AND dwl.entry_date = p_date
    GROUP BY dwl.item_id
  ),
  taste AS (
    SELECT dtl.item_id, COALESCE(SUM(dtl.estimated_grams), 0) as total_tasting
    FROM daily_tasting_log dtl
    WHERE dtl.store_id = p_store_id AND dtl.entry_date = p_date
    GROUP BY dtl.item_id
  ),
  thresholds AS (
    SELECT vt.item_id, vt.category_id, vt.threshold_percent
    FROM variance_thresholds vt
  )
  SELECT 
    i.id as item_id,
    i.name::TEXT as item_name,
    ic.name::TEXT as category_name,
    i.uom::TEXT as uom,
    COALESCE(s.opening_stock, 0) as opening_stock,
    COALESCE(s.closing_stock, 0) as closing_stock,
    COALESCE(s.actual_used, 0) as actual_consumption,
    COALESCE(t.theo_consumption, 0) as theoretical_consumption,
    COALESCE(w.total_wastage, 0) as wastage,
    COALESCE(ta.total_tasting, 0) as tasting,
    (COALESCE(s.actual_used, 0) - COALESCE(w.total_wastage, 0) - COALESCE(ta.total_tasting, 0) - COALESCE(t.theo_consumption, 0)) as variance,
    CASE 
      WHEN COALESCE(t.theo_consumption, 0) > 0 THEN
        ROUND(((COALESCE(s.actual_used, 0) - COALESCE(w.total_wastage, 0) - COALESCE(ta.total_tasting, 0) - COALESCE(t.theo_consumption, 0)) / t.theo_consumption) * 100, 2)
      ELSE 0
    END as variance_percent,
    COALESCE(
      (SELECT th.threshold_percent FROM thresholds th WHERE th.item_id = i.id LIMIT 1),
      (SELECT th.threshold_percent FROM thresholds th WHERE th.category_id = i.category_id LIMIT 1),
      (SELECT th.threshold_percent FROM thresholds th WHERE th.item_id IS NULL AND th.category_id IS NULL LIMIT 1),
      5.0
    ) as threshold_percent,
    CASE
      WHEN ABS(
        CASE 
          WHEN COALESCE(t.theo_consumption, 0) > 0 THEN
            ((COALESCE(s.actual_used, 0) - COALESCE(w.total_wastage, 0) - COALESCE(ta.total_tasting, 0) - COALESCE(t.theo_consumption, 0)) / t.theo_consumption) * 100
          ELSE 0
        END
      ) <= COALESCE(
        (SELECT th.threshold_percent FROM thresholds th WHERE th.item_id = i.id LIMIT 1),
        (SELECT th.threshold_percent FROM thresholds th WHERE th.category_id = i.category_id LIMIT 1),
        (SELECT th.threshold_percent FROM thresholds th WHERE th.item_id IS NULL AND th.category_id IS NULL LIMIT 1),
        5.0
      ) THEN 'OK'
      ELSE 'EXCEEDED'
    END::TEXT as status
  FROM items i
  JOIN item_categories ic ON ic.id = i.category_id
  LEFT JOIN stock s ON s.item_id = i.id
  LEFT JOIN theoretical t ON t.item_id = i.id
  LEFT JOIN waste w ON w.item_id = i.id
  LEFT JOIN taste ta ON ta.item_id = i.id
  WHERE i.is_daily_tracked = true AND i.is_active = true
    AND (s.item_id IS NOT NULL OR t.item_id IS NOT NULL)
  ORDER BY ic.sort_order, i.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
