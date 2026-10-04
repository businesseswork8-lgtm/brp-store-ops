-- ==========================================================
-- 005_br_flavours.sql
-- Baskin Robbins: track every flavour separately (from Master Data)
-- Safe to run more than once.
-- ==========================================================

-- 1. Extra item fields
ALTER TABLE items ADD COLUMN IF NOT EXISTS code TEXT;              -- e.g. FLV-001
ALTER TABLE items ADD COLUMN IF NOT EXISTS sub_category TEXT;      -- Fruits / Classics & Nuts / Chocolates
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_new BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS tare_grams NUMERIC NOT NULL DEFAULT 0;  -- empty tub weight
CREATE UNIQUE INDEX IF NOT EXISTS items_code_unique ON items(code) WHERE code IS NOT NULL;

ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS is_flavour BOOLEAN NOT NULL DEFAULT false;

-- Number of tubs weighed (so the empty-tub weight can be subtracted)
ALTER TABLE daily_stock_entries ADD COLUMN IF NOT EXISTS opening_containers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stock_entries ADD COLUMN IF NOT EXISTS closing_containers INTEGER NOT NULL DEFAULT 0;

-- 2. Flavour categories (Baskin Robbins)
INSERT INTO item_categories (id, brand_id, name, sort_order, is_flavour) VALUES
  ('cf000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Gelato', 1, true),
  ('cf000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Timeless', 2, true),
  ('cf000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Favourite', 3, true),
  ('cf000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Divine / Gourmet', 4, true)
ON CONFLICT (id) DO UPDATE SET is_flavour = true;

UPDATE item_categories SET sort_order = 10 WHERE id = 'c7777777-7777-7777-7777-777777777777'; -- Sundaes & Cones after flavours

-- 3. The 34 flavours (grams, 100 g empty bulk box)
INSERT INTO items (category_id, code, name, sub_category, is_new, uom, purchase_unit_name, purchase_unit_qty, is_daily_tracked, is_active, tare_grams)
SELECT v.cat, v.code, v.name, v.sub, v.is_new, 'grams', 'Tub', 1, true, true, 100
FROM (VALUES
  ('FLV-001', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Mango & Cream', 'Fruits', false),
  ('FLV-002', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Blueberry Cheesecake', 'Fruits', false),
  ('FLV-003', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Strawberry Matcha', 'Classics & Nuts', true),
  ('FLV-004', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Cotton Candy Burst', 'Classics & Nuts', false),
  ('FLV-005', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Dubai Chocolate', 'Chocolates', true),
  ('FLV-006', 'cf000000-0000-0000-0000-000000000001'::uuid, 'Chocolate & Roasted Hazelnut', 'Chocolates', false),
  ('FLV-007', 'cf000000-0000-0000-0000-000000000002'::uuid, 'Very Berry Strawberry', 'Fruits', false),
  ('FLV-008', 'cf000000-0000-0000-0000-000000000002'::uuid, 'Classic Vanilla', 'Classics & Nuts', false),
  ('FLV-009', 'cf000000-0000-0000-0000-000000000002'::uuid, 'Butterscotch Ribbon', 'Classics & Nuts', false),
  ('FLV-010', 'cf000000-0000-0000-0000-000000000002'::uuid, 'Three Cheers Chocolate', 'Chocolates', false),
  ('FLV-011', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Banana ''N'' Strawberry', 'Fruits', false),
  ('FLV-012', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Alphonso Mango', 'Fruits', false),
  ('FLV-013', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Fruit Overload', 'Fruits', false),
  ('FLV-014', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Roasted Californian Almond', 'Classics & Nuts', false),
  ('FLV-015', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Splish Splash', 'Classics & Nuts', false),
  ('FLV-016', 'cf000000-0000-0000-0000-000000000003'::uuid, 'Dutch Chocolate', 'Chocolates', false),
  ('FLV-017', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Black Currant', 'Fruits', false),
  ('FLV-018', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Shooting Star', 'Fruits', false),
  ('FLV-019', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Beach Day', 'Classics & Nuts', true),
  ('FLV-020', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Biscoff', 'Classics & Nuts', false),
  ('FLV-021', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Cookies ''N Cream', 'Classics & Nuts', false),
  ('FLV-022', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Cotton Candy', 'Classics & Nuts', false),
  ('FLV-023', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Honey Nut Crunch', 'Classics & Nuts', false),
  ('FLV-024', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Hop Scotch Butterscotch', 'Classics & Nuts', false),
  ('FLV-025', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Pralines N Cream', 'Classics & Nuts', false),
  ('FLV-026', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Hat-trick', 'Chocolates', true),
  ('FLV-027', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Choco Chip Cookie Dough', 'Chocolates', false),
  ('FLV-028', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Mississippi Mud', 'Chocolates', false),
  ('FLV-029', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Chocolate Mousse Royale', 'Chocolates', false),
  ('FLV-030', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Gold Medal Ribbon', 'Chocolates', false),
  ('FLV-031', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Bavarian Chocolate', 'Chocolates', false),
  ('FLV-032', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Chocolate Almond Praline', 'Chocolates', false),
  ('FLV-033', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Mint Milk Chocolate Chip', 'Chocolates', false),
  ('FLV-034', 'cf000000-0000-0000-0000-000000000004'::uuid, 'Belgian Bliss', 'Chocolates', false)
) AS v(code, cat, name, sub, is_new)
WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.code = v.code);

-- 4. Replace the single generic "Ice Cream Base" (kept for old history, hidden from staff)
UPDATE items SET is_active = false WHERE id = 'a0020000-0000-0000-0000-000000000001';

-- 5. Scoop / pack weights from Master Data
UPDATE recipe_ingredients SET quantity = 62  WHERE recipe_id = 'b0020000-0000-0000-0000-000000000001'; -- Small Scoop
UPDATE recipe_ingredients SET quantity = 94  WHERE recipe_id = 'b0020000-0000-0000-0000-000000000002'; -- Regular Scoop
UPDATE recipe_ingredients SET quantity = 224 WHERE recipe_id = 'b0020000-0000-0000-0000-000000000003'; -- Double Scoop
UPDATE recipe_ingredients SET quantity = 263 WHERE recipe_id = 'b0020000-0000-0000-0000-000000000004'; -- Family Pack
UPDATE recipe_ingredients SET quantity = 368 WHERE recipe_id = 'b0020000-0000-0000-0000-000000000005'; -- Value Pack
UPDATE recipe_ingredients SET quantity = 525 WHERE recipe_id = 'b0020000-0000-0000-0000-000000000006'; -- Party / Happiness Pack

-- 6. Who may add / remove flavours: Super Admin, or Admin with "Allowed to edit"
CREATE OR REPLACE FUNCTION public.is_editor() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active
      AND (role = 'super_admin' OR (role = 'admin' AND can_edit))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_flavour_category(cat UUID) RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_flavour FROM public.item_categories WHERE id = cat), false);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "Editors add flavours" ON items;
CREATE POLICY "Editors add flavours" ON items FOR INSERT
  WITH CHECK (public.is_editor() AND public.is_flavour_category(category_id));

DROP POLICY IF EXISTS "Editors update flavours" ON items;
CREATE POLICY "Editors update flavours" ON items FOR UPDATE
  USING (public.is_editor() AND public.is_flavour_category(category_id))
  WITH CHECK (public.is_editor() AND public.is_flavour_category(category_id));
