-- =====================================================================
-- 010_rista_master_and_audits.sql — Rista item list + month-end / company audits (5 Oct 2026)
-- Run ONCE in Supabase → SQL Editor → Run, BEFORE pushing the code. Safe to re-run.
-- Requires 009_simplify.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The complete Rista material list per brand (add items only from here = no typing errors)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rista_materials (
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  category TEXT,
  sub_category TEXT,
  unit TEXT,                      -- kg / Nos / lt (as Rista counts it)
  rate NUMERIC,                   -- ₹ per unit
  perishable BOOLEAN NOT NULL DEFAULT false,
  is_critical BOOLEAN NOT NULL DEFAULT false,   -- on the company audit's critical list
  stock_group TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, sku)
);
ALTER TABLE rista_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View rista materials" ON rista_materials;
CREATE POLICY "View rista materials" ON rista_materials FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Editors manage rista materials" ON rista_materials;
CREATE POLICY "Editors manage rista materials" ON rista_materials FOR ALL
  USING (public.is_editor()) WITH CHECK (public.is_editor());

-- Update the list from a Rista file (Consumption Variance or month-end audit). Rates update linked items too.
CREATE OR REPLACE FUNCTION public.refresh_rista_materials(p_brand UUID, p_rows JSONB) RETURNS INTEGER AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT public.is_editor() THEN RAISE EXCEPTION 'Only the Super Admin or an Admin allowed to edit can update the Rista list'; END IF;
  INSERT INTO rista_materials (brand_id, sku, name, type, category, sub_category, unit, rate, perishable, stock_group, updated_at)
  SELECT p_brand, x->>'sku', x->>'name', NULLIF(x->>'type',''), NULLIF(x->>'category',''), NULLIF(x->>'sub_category',''),
         NULLIF(x->>'unit',''), NULLIF(x->>'rate','')::numeric, COALESCE((x->>'perishable')::boolean, false),
         NULLIF(x->>'stock_group',''), now()
  FROM jsonb_array_elements(p_rows) x WHERE COALESCE(x->>'sku','') <> '' AND COALESCE(x->>'name','') <> ''
  ON CONFLICT (brand_id, sku) DO UPDATE SET
    name = EXCLUDED.name,
    type = COALESCE(EXCLUDED.type, rista_materials.type),
    category = COALESCE(EXCLUDED.category, rista_materials.category),
    sub_category = COALESCE(EXCLUDED.sub_category, rista_materials.sub_category),
    unit = COALESCE(rista_materials.unit, EXCLUDED.unit),      -- keep the unit already known
    rate = COALESCE(EXCLUDED.rate, rista_materials.rate),
    stock_group = COALESCE(EXCLUDED.stock_group, rista_materials.stock_group),
    updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE items i SET rate = m.rate
  FROM rista_materials m, item_categories ic
  WHERE ic.id = i.category_id AND ic.brand_id = p_brand AND m.brand_id = p_brand AND m.sku = i.rista_sku AND m.rate IS NOT NULL;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- 99 Pancakes: 378 materials from the Sept 2026 month-end audit, Consumption Variance and company audit report
INSERT INTO rista_materials (brand_id, sku, name, type, category, sub_category, unit, rate, perishable, is_critical, stock_group) VALUES
  ('11111111-1111-1111-1111-111111111111', '147', 'Bubbles Strawberry', 'Material', 'Raw Material', 'Grocery', 'kg', 399.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '864', 'Cadbury Gems PKT(17 gms)', 'Material', 'Raw Material', 'Grocery', 'kg', 550.62, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1384', 'Cake Box 9*9 (1 kg)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 19.82, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '354', 'Caramel Balls', 'Material', 'Raw Material', 'Grocery', 'kg', 1324.71, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3602', 'Caramel La Sauce', 'Material', 'Raw Material', 'Grocery', 'kg', 696.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2270', 'Cash Drawer TPC - 415', 'Material', 'Assets & Small Ware', 'Equipment and Machinery', 'Nos', 11800.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '308', 'Cello Tape', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 34.04, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3272', 'Cheese Cake Crumble', 'Material', 'Raw Material', 'Grocery', 'kg', 314.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '341', 'Chef Cap Plastic', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 1.14, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '140', 'Chip Sprinklers Dark', 'Material', 'Raw Material', 'Grocery', 'kg', 1407.56, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '433', 'Chip Sprinklers White', 'Material', 'Raw Material', 'Grocery', 'kg', 1407.63, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '118', 'Choco Chips', 'Material', 'Raw Material', 'Grocery', 'kg', 314.55, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '874', 'Choco Filling(Coffee Spread)', 'Material', 'Raw Material', NULL, 'kg', 408.16, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1170', 'Chocolate Fantasy Cake  [450 gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 222.45, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '129', 'Chocolate Ice Cream Bulk', 'Material', 'Raw Material', 'Grocery', 'kg', 320.27, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3323', 'Cinnamon Sugar (500gm)', 'Material', 'Raw Material', 'Grocery', 'kg', 220.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '878', 'Cocoa Powder', 'Material', 'Raw Material', 'Grocery', 'kg', 1023.33, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '264', 'Coffee Beans', 'Material', 'Raw Material', 'Grocery', 'kg', 1050.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '277', 'Coffee Glass', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 4.91, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '830', 'Happy Birthday Tag', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 0.45, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1133', 'Hot Chocolate Planter', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 53.38, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '343', 'Icecream Cup (Paper)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 3.11, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '437', 'Icecream Lid', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 1.18, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '120', 'Icing Sugar (1 kg)', 'Material', 'Raw Material', 'Grocery', 'kg', 92.64, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '761', 'Juicy Peach Ice Tea Premix (1 kg)', 'Material', 'Raw Material', 'Grocery', 'kg', 402.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '712', 'KitKat 4Fingers', 'Material', 'Raw Material', 'Grocery', 'kg', 803.92, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', 'E-26', 'Kot Holder(Khomcha)', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 134.4, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3641', 'Kunafa (75 grm)', 'Material', 'Raw Material', 'Grocery', 'kg', 750.4, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '233', 'Lizol', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 175.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '1524', 'Lotus Biscoff Spread (400 gms)', 'Material', 'Raw Material', 'Grocery', 'kg', 1260.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1525', 'Lotus Spread Biscuit(250grm)', 'Material', 'Raw Material', 'Grocery', 'kg', 1132.92, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1679', 'Macaron Box (4pc)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 7.82, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '357', 'Mango Crush', 'Material', 'Raw Material', 'Grocery', 'kg', 313.83, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '131', 'Mango Ice Cream Bulk', 'Material', 'Raw Material', 'Grocery', 'kg', 274.42, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2242', 'Menu card', 'Material', 'Miscellaneous', 'Marketing Material', 'Nos', 0.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '1288', 'Milk Chocolate Filling', 'Material', 'Raw Material', 'Grocery', 'kg', 340.73, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '126', 'Milk Tetra Pack', 'Material', 'Raw Material', 'Grocery', 'kg', 75.53, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3350', 'Mini Cone Paper Waffle', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 1.65, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '587', 'Cone Paper(Waffle)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 2.21, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-54', 'Crape Stick Container (6*12)', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 472.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3405', 'Cream Mix', 'Material', 'Raw Material', 'Grocery', 'kg', 427.31, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3633', 'Cremica Fudge Sauce\t', 'Material', 'Raw Material', 'Grocery', 'kg', 331.56, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', 'E-107', 'DSSR Book', 'Material', 'Miscellaneous', 'Printing & Stationery', 'Nos', 218.79, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '353', 'Dark Chocolate Filling', 'Material', 'Raw Material', 'Grocery', 'kg', 406.88, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM25', 'Dark Chocolate Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '2552', 'Desktop Computer', 'Material', 'Assets & Small Ware', 'Equipment and Machinery', 'Nos', 31860.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '262', 'Dlecta Cream Cheese', 'Material', 'Raw Material', 'Grocery', 'kg', 803.01, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN270', 'Double Choco Chips Brownie', 'Material', 'Raw Material', 'Grocery', 'kg', 430.5, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN626', 'Dutch Truffle Cake [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 266.95, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3297', 'Flora Macaron box (12pc)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 101.24, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3298', 'Flora Macaron box (6pc)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 89.41, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '2543', 'Fondue Box', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 488.52, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '2691', 'Fryer Machine (6lt) (Electric)', 'Material', 'Assets & Small Ware', 'Equipment and Machinery', 'Nos', 0.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '307', 'Gloves 100 eas (Box)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 3.75, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '237', 'Handwash Liquid', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 142.17, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '831', 'Happy Anniversary Tag', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 0.45, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-3', 'Mini Pancake Maker(25)', 'Material', 'Assets & Small Ware', 'Equipment and Machinery', 'Nos', 21240.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '257', 'Miracle Premix', 'Material', 'Raw Material', 'Grocery', 'kg', 294.52, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '770', 'Mix Berry Ice Tea Premix', 'Material', 'Raw Material', 'Grocery', 'kg', 405.71, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2803', 'Mobile Phone', 'Material', 'Assets & Small Ware', 'Equipment and Machinery', 'Nos', 0.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2533', 'Mop Refil', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 147.47, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-81', 'Name Tag Sticker', 'Material', 'Miscellaneous', 'Store Exclusive', 'Nos', 3.54, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3079', 'Napkin', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', -0.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN829', 'Normal Candle', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 0.22, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '123', 'Nutella', 'Material', 'Raw Material', 'Grocery', 'kg', 587.29, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '300', 'Nutella Injection (10ml)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 4.35, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '523', 'Nutella Injection Sticker', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 0.8, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM13', 'Nutella Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN389', 'Nutella Pastry', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 117.45, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '127', 'Nutralite Butter', 'Material', 'Raw Material', 'Grocery', 'kg', 220.57, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '253', 'Oil Sunflower', 'Material', 'Raw Material', 'Grocery', 'kg', 155.0, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '124', 'Oreo', 'Material', 'Raw Material', 'Grocery', 'kg', 243.68, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '122', 'Pancake Syrup', 'Material', 'Raw Material', 'Grocery', 'kg', 336.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2393', 'Pancakes Machine (25 pcs) coating', 'Material', 'Miscellaneous', 'Store Exclusive', 'Nos', 3500.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '956', 'Red Velvet Premix', 'Material', 'Raw Material', 'Grocery', 'kg', 210.0, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2837', 'Round Roll Sticker', 'Material', 'Miscellaneous', 'Store Packaging Material', 'Nos', 0.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '265', 'Sachets Sugar', 'Material', 'Raw Material', 'Grocery', 'Nos', 0.79, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', 'E-25', 'Scoops For Ice Creams', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 472.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '342', 'Screwer Stick 6 inch', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 1.19, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '443', 'Shake Glass With Lid (500ML)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 9.35, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-18', 'Spatula (Small)', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 214.91, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-16', 'Squeezy Bottle - Big', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 132.36, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-17', 'Squeezy Bottle 3 Holes', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 118.0, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '1430', 'Strawberry  crush(1lt)', 'Material', 'Raw Material', 'Grocery', 'lt', 214.86, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM31', 'Strawberry Cheese Cake Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '435', 'Strawberry Filling', 'Material', 'Raw Material', 'Grocery', 'kg', 472.5, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '132', 'Strawberry Ice Cream Bulk', 'Material', 'Raw Material', 'Grocery', 'kg', 280.34, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3830', 'Sweet mate', 'Material', 'Raw Material', 'Grocery', 'kg', 250.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '238', 'Table Mop ( SB Wipe )', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 51.13, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-63', 'Tea Spoon', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 212.4, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '347', 'Tissue', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 0.24, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '234', 'Towel Duster ( Dust 40*60 Micro Napkin )', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 28.2, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '320', '1 Pastry Box New', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 4.9, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '321', '2 Pastry Box New', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 6.25, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3038', 'Almond Chocolate Filling (1 kg)', 'Material', 'Raw Material', 'Grocery', 'kg', 446.27, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '136', 'Almond Flakes', 'Material', 'Raw Material', 'Grocery', 'kg', 1343.23, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '113', 'Banana', 'Material', 'Raw Material', 'Grocery', 'Nos', 0.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM19', 'Biscoff Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN514', 'Bisleri Vedica Water Bottle (500ml)', 'Material', 'Raw Material', 'Grocery', 'Nos', 15.75, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1212', 'Black Lemonade', 'Material', 'Raw Material', 'Grocery', 'kg', 477.5, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '116', 'BlueBerry Compote', 'Material', 'Raw Material', 'Grocery', 'kg', 481.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '747', 'Bottle with Lid 350ml (30 pcs)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 13.23, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2325', 'Brownie Brittle Chips Almond', 'Material', 'Raw Material', 'FMCG', 'Nos', 69.3, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2327', 'Brownie Brittle Chips Coffee', 'Material', 'Raw Material', 'FMCG', 'Nos', 68.25, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3863', 'Brownie Cake (200 grm)', 'Material', 'Raw Material', 'Grocery', 'Nos', 126.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3271', 'Brownie Temptation Pastry', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 75.6, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1131', 'Brownie Temptation [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 293.64, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '1017', 'Bubblegum Chocolate filling', 'Material', 'Raw Material', 'Grocery', 'kg', 432.81, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM01', 'Bubblegum Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '146', 'Bubbles Mango', 'Material', 'Raw Material', 'Grocery', 'kg', 403.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1065', 'Paper Carry Bag (Big)', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 13.02, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '1064', 'Paper Plates', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 2.53, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '541', 'Paper Straws', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 1.25, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3418', 'Paper Tub With Lid (500 ML)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 11.21, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '383', 'Parcel Box ( 6 Pcs )', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 3.67, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '379', 'Parcel Box (12PC)', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 4.96, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1838', 'Pineapple Cake  [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 266.95, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1833', 'Pineapple Pastry', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 64.26, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3829', 'Pink Lemonade Premix', 'Material', 'Raw Material', 'Grocery', 'kg', 558.57, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1467', 'Piping Bag', 'Material', 'Packaging Material', 'Other Consumables', 'ea', 1.78, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3634', 'Pistachio Filling', 'Material', 'Raw Material', 'Grocery', 'kg', 1084.29, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3684', 'Plastic Spoon', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 2.39, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '588', 'Premix Cold Coffee', 'Material', 'Raw Material', 'Grocery', 'kg', 559.67, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3348', 'Printed Paper Bag (9*7)', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 3.97, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '338', 'Printer Roll', 'Material', 'Miscellaneous', 'Printing & Stationery', 'Nos', 47.23, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '1391', 'Puff Bag Big', 'Material', 'Packaging Material', 'Other Consumables', 'Nos', 0.0, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PM3757', 'Quinoa Almond Pancake & Waffle Mix (200Gm)', 'Material', 'Raw Material', 'FMCG', 'Nos', 150.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '561', 'Rainbow Sprinklers', 'Material', 'Raw Material', 'Grocery', 'kg', 261.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN863', 'Red Velvet Cookies (250 gms)', 'Material', 'Raw Material', 'Snacks & Quick Bites', 'kg', 357.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '158', 'Tray 12 Pcs', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 4.37, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '157', 'Tray 6 Pcs', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 3.28, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-50', 'Uniform T Shirt (M)', 'Material', 'Miscellaneous', 'Store Exclusive', 'Nos', 0.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-51', 'Uniform T Shirt (S)', 'Material', 'Miscellaneous', 'Store Exclusive', 'Nos', 420.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2490', 'Uniform T shirt', 'Material', 'Miscellaneous', 'Store Exclusive', 'Nos', 420.0, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3642', 'Vanilla Frappe Powder', 'Material', 'Raw Material', 'Grocery', 'kg', 574.87, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '133', 'Vanilla Ice Cream Bulk', 'Material', 'Raw Material', 'Grocery', 'kg', 281.86, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '591', 'Waffle 2Pc Box', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 5.53, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3349', 'Waffle 4 Pc Box', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 9.77, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3603', 'Waffle Cake Box', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 10.87, false, true, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-55', 'Water Glass', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 212.4, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '762', 'Watermelon Ice Tea Premix', 'Material', 'Raw Material', 'Grocery', 'kg', 450.0, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '281', 'Whipped Cream', 'Material', 'Raw Material', 'Grocery', 'kg', 231.02, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '150', 'White Chocolate Fillings', 'Material', 'Raw Material', 'Grocery', 'kg', 340.73, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '380', 'Wooden Knife', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 0.57, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '378', 'Wooden Spork', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 0.92, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-23', 'Wooden Stick For Crapes', 'Material', 'Assets & Small Ware', 'Utensil and more', 'Nos', 201.6, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '152', 'Wooden Stick with Flag', 'Material', 'Packaging Material', 'Store Packaging Material', 'Nos', 1.15, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '230', 'vim bar', 'Material', 'Miscellaneous', 'House Keeping', 'Nos', 94.73, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1319', 'Bake Cheese Cake [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 300.32, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1041', 'Apple Cinnemon Pie', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 80.08, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3669', 'Biscoffe Cheese Cake Pastry (110 grm)', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 98.77, false, false, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3668', 'Blueberry Cheese Cake Pastry (115 grm)', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 98.77, false, false, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3597', 'Coco Bravo Pastry (85 gm)', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 106.78, false, false, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN420', 'Classic Cheese Cake Pastry (95 grm)', NULL, 'Raw Material', 'Cakes & Dessert', 'Nos', 75.07, false, false, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3686', 'Chocolate Marquies Pastry (95gm) 9pcs', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 119.7, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2567', 'Hot chocolate Bomb (9Nos)', 'Material', 'Raw Material', 'Chocolates & Bar', 'Nos', 80.0, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3261', 'Nutella Cake (1 Kg)', NULL, 'Raw Material', 'Cakes & Dessert', 'Nos', 694.07, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1034', 'Nutella Cake  [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 347.04, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1702', 'Mona Lisa Mango Cake', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 390.0, false, false, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3128', 'Mona Lisa Cake [500gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 347.04, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1039', 'Red Velvet Cake [350gm]', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 293.64, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PANNM43', 'Orange Chocolate Macaron', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 22.25, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3685', 'Orange Chocolate Cheese Cake Pastry (100gm)', 'Material', 'Raw Material', 'Cakes & Dessert', 'Nos', 116.55, false, true, 'Cakes & Pastries'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2328', 'Brownie Brittle Chips Double Choco', 'Material', 'Raw Material', 'FMCG', 'Nos', 68.25, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2326', 'Brownie Brittle Chips Protein', 'Material', 'Raw Material', 'FMCG', 'Nos', 68.25, false, true, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '125', 'Strawberry Syrup', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '231', 'vim liquid', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '232', 'Glass Cleaner', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '235', 'Scotch Brite', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '267', 'Sachet Brown Sugar', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '272', 'Tea Masala', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '279', 'Tea Elachi', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '298', 'Thermoster and switch change', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '309', 'Cling wrap', 'Material', 'Packaging Material', NULL, 'Meter', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '310', 'Silver foil', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '312', 'BTL Menu Flyer A4', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '319', 'Big 99 pancakes sticker', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '326', 'Voucher Book', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '329', 'Dustbin Bags Big', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '414', 'Mango Fresh', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '535', 'Sachets Paprika', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '536', 'Sachets Oregano', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '537', 'Sachet Tomato Ketchup', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '564', 'Pizza Masala', 'Material', 'Raw Material', NULL, 'g', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '718', 'Marshmallow(160grm)', 'Material', 'Raw Material', NULL, 'g', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '769', 'Pizza Box 6"inch', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '779', 'Pizza Sauce', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1057', '4 Pastry Box New', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '1198', 'Jalapeno slice(3.1kg)', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1667', 'Coffee Lid', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '1748', 'Savoury Waffle Mix(1kg)', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1755', 'Liquid Cheese(500gm)', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1848', 'Bottle Warmer', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '1952', 'Blend Mozzarella Cheese', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1965', 'Black olive slice', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '1997', 'Phenyle (1lt)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2112', 'Harpic', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-1', 'Crape Machine', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-2', 'Coffee Machine (Gaggia)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-4', 'Waffle Machine', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-5', 'Thich Shake Maker', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-6', 'Weigh Scale', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-7', 'Cream Beater', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-8', 'Hand Blender', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-9', 'Pizza Machine (16*16)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-10', 'Waffle Neon (1.5 Ft * 1.5 Ft )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-12', 'Plastic Jug 1Lt (For Batter Filling In Bottle)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-13', 'Containers Black / Transparent', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-14', 'Lid Containers Black Transparent', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-15', 'Squeezy Bottles - Jumbo For Minipancakes', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-19', 'Brush Silicon For Butter Greasing (Small)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-21', 'Tissue Paper Holder', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-22', 'Fork / Spoon Holder Grey Pvc', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-24', 'Steelnes Stainer (Round)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-27', 'Bill Holder', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-28', 'Plastic Jug (5Lt)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-29', 'Plastic Jug (2Lt)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-30', 'Flag Holder / Tooth Pick Holder', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-31', 'Round Bowls Plastic', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-32', 'Round Bowls Plastic (Big)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-33', 'Piping Bags (Silicon)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-34', 'Plate Knife (Crapes 12 inch)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-35', 'Dabbu For Batter', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-36', 'Service Spoons (Toppings)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-37', 'Glass Topping Container Blue Lid', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-38', 'Cutting / Chopping Board', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-39', 'Service Spoons Sauce Etc..', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-40', 'Knife', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-41', 'Melamine Quarter Plates', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-42', 'Plastic Container - (Xl Set Of 5 Pcs)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-43', 'Plastic Container - Xxl (Set Of 5 Pcs)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-44', 'Glass Jars For Display And Toppings', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-45', 'Measurement Glass (200 Ml)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-46', 'Wooden Spoon Big', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-47', 'Measuring Spoon Set (5Pcs)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-48', 'Manager Shirt', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-49', 'Uniform - T Shirt (L)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-52', 'Uniforms - Caps', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-53', 'Aprons', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-56', 'Pizza Cutter 5 "', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-57', 'Plate Knife (Waffle 6 inch)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-58', 'Tonge', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-59', 'Injection Stand (10 Ml)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-60', 'Nozel', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-61', 'G N Pan Ss (8*8*8) Ice Cream Bulk', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-62', 'Lid G N Pan Ss (8*8*8) Ice Cream Bulk', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-64', 'Coffee Mug', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-65', 'Americano Cups & Saucer', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-66', 'Wooden Standees', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-68', 'Dustbin Large(100Ltr)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-69', 'Magic Floor Mop ( Wotra Prospin S310 )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-70', 'Sign No Smoking', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-71', 'Sign Wash Hand', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-72', 'Sign U R On Camera', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-73', 'Sign Fire Extinguishers', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-74', 'Sign Dustbin', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-77', 'Acrylic Tags', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-78', 'Dome Cover Lid', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-82', 'Basket', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-84', 'Fly Killer (Elite / Similar)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-92', 'Microwave', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-93', 'Under Table Refrigerator', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-94', 'Television Sets (43Inch ) ( V U Brand )', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-95', 'Woofer Speaker', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2225', 'A4 size Sunboard', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2226', '2*3 size Sunboard', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2263', 'Vinyl Print ( 2 * 3.5 ft )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2269', 'Card Printout (Acrelic Stand)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2290', 'Tend Card Print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2299', 'Tag Print (Bislery water)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2300', 'Photo Paper Print 2*3ft (Matt lamination)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2301', 'Photo Paper Print A/3 (Matt lamination)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2306', 'Card Printout A/5 digital print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', 'E-101', 'Pizza Plater ( Wooden )', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-103', 'Pastry Lifter', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-104', 'Mocktail Shaker', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-105', 'Acrylic sheets (Round)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-106', 'Acrylic Sheet (Rectangle)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-108', 'Shake Glass(285ml)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', 'E-111', 'SS Dustbin (70liter)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2356', 'Shake Blender', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2379', 'Turn Table', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2380', 'Step Ladder', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2381', 'Broom', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2382', 'Dust Pan(Supdi)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2390', 'Id Card', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2391', 'Pancakes Plate(50 pcs) Coating', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2392', 'Waffle Coating Plate', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2394', 'Crape Plate Coating', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2414', 'Express Book', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2415', 'Challan Book', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2419', 'Coffee machine Parts', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2423', 'Coupon Print Big size', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2424', 'Flex Print(4X8)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2425', 'Coupon Print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2439', 'Screen printing', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2444', 'Merchandise@RS799', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2446', 'Merchandise@RS699', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN2452', 'GBT-2375 Merchandise@RS599', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2466', 'Feedback Book', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2479', 'Alphonso mango Pulp', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2502', 'Neo Digital Signage', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2504', 'Chair', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2535', 'Fly ketcher pad', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2546', 'A/5 Acrylic Tent card Standee', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2548', 'Macaron Stand', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2555', 'Acrylic Plates (12*17Mm)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2558', 'Tin Cutter (Opner)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2560', 'Spatula big', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2566', 'Frame(30X40 cm)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2575', 'Folding Stool', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2639', 'Vinyl Pasting', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2675', 'Note Pad', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2710', 'Hazelnut Syrup(Monin)', 'Material', 'Raw Material', NULL, 'lt', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2711', 'Vanilla  Syrup(Monin)', 'Material', 'Raw Material', NULL, 'lt', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '2739', 'Clip', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2749', 'Fire Extinguishers', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2843', 'Sunboard Print ( 2 * 5 ft )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2844', 'Sunboard Print ( 2 * 3.5 ft 5 mm )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2871', 'Deep Freezer (550)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '2872', 'Coupon Print Big', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2874', 'Flyer A/5 Size', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2875', 'A/5 Tent Card printing', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2908', 'Tile brush big', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2911', 'Sticker Paper A4 Size', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2930', 'Magic Mop', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2972', 'Card Printout A/3', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2975', 'Tent Card Printing ( Triangle )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '2976', 'Card Printout A6', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3021', 'Flex Print (3X8)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3022', 'Translite Print 2*3', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3023', 'Sunboard Print A/5', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3051', 'Sunboard print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3052', 'Vinyl Print ( 3* 3 ft )', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3054', 'Sunboard  Print  A/3 Ft', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3063', 'Danglers Print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3069', 'QR Code Printing', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3102', 'GBT-180 Merchandise@RS299', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3103', 'GBT-174 Merchandise@RS499', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3104', 'GBT-3408 Merchandise@RS399', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3114', 'Outdoor Cafeteria Table', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3140', 'Frame (21X30)', 'Material', 'Assets & Small Ware', NULL, 'ea', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3182', 'Mango Fruit Filling', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3233', 'Flex Print(4X4)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3268', 'Magnetic macron box (6pc)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3269', 'Magnetic macron box (12pc)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3347', 'Crolls Stand', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3385', 'Rosete Chair', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3391', 'Dustbin Small (60 lt)', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3396', 'A/4 Standee', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3402', 'Vinyl Print (Partition Wall Branding)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3404', 'Uniform T-Shirt (XL)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3408', 'Merchandise@RS899', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3409', 'Rosete High Stool', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3415', 'Geyser', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3443', 'Merchandise@999', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3474', 'SS Cooling Rack 60*40 CM', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3512', 'Mascot (99 Pancakes)', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3620', 'SS Plate knife 5"', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3682', 'Ice Cube Tray', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3723', 'Sunboard Print', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PM3753', 'Classic Pancakes & Waffle Mix (200Gm)', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PM3754', 'Multi Millet Pancakes & Waffle Mix (200Gm)', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PM3755', 'Multigrain Pancakes & Waffle Mix (200Gm)', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '99PM3756', 'Chocolate Pancakes & Waffle Mix (200Gm)', 'Material', 'Raw Material', NULL, 'Nos', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3776', 'Paper Box(5*5)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3783', 'Wooden Stick 12 inch (50pc)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '3792', 'Warmer', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3801', 'Wooden Brush', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '3802', 'Glass Bowl', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3805', 'Key Chain', 'Material', 'Miscellaneous', NULL, 'Nos', NULL, false, false, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '1904', 'Plain Paper handle Bag(9*7)', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '1963', 'Raksha Bandhan Hamper Box', 'Material', 'Packaging Material', NULL, 'ea', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', 'E-88', 'Bill Thermal Printer', 'Material', 'Assets & Small Ware', NULL, 'Nos', NULL, false, false, 'Assets'),
  ('11111111-1111-1111-1111-111111111111', '3844', 'BTS Oreo', 'Material', 'Raw Material', NULL, 'kg', NULL, false, false, 'Raw Material'),
  ('11111111-1111-1111-1111-111111111111', '3371', '300 ml IceCream (Paper Tub) with lid', 'Material', 'Packaging Material', NULL, 'Nos', NULL, false, false, 'Packaging'),
  ('11111111-1111-1111-1111-111111111111', '99PAN3264', 'Brownie Temptation (1 Kg)', NULL, NULL, NULL, 'nos', 608.64, false, true, 'Other'),
  ('11111111-1111-1111-1111-111111111111', '99PAN1140', 'Dutch Truffle Cake [1 kg]', NULL, NULL, NULL, 'nos', 560.6, false, true, 'Other')
ON CONFLICT (brand_id, sku) DO UPDATE SET
  name = EXCLUDED.name, rate = COALESCE(EXCLUDED.rate, rista_materials.rate),
  is_critical = rista_materials.is_critical OR EXCLUDED.is_critical, stock_group = EXCLUDED.stock_group;

-- ---------------------------------------------------------------------
-- 2. 99 Pancakes items = Rista items
--    a) link the old app items that exist in Rista
-- ---------------------------------------------------------------------
UPDATE items i SET rista_sku = '257', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '257' AND i.id = 'a0010000-0000-0000-0000-000000000001' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '353', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '353' AND i.id = 'a0010000-0000-0000-0000-000000000002' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '1288', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '1288' AND i.id = 'a0010000-0000-0000-0000-000000000003' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '150', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '150' AND i.id = 'a0010000-0000-0000-0000-000000000004' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '123', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '123' AND i.id = 'a0010000-0000-0000-0000-000000000005' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '1524', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '1524' AND i.id = 'a0010000-0000-0000-0000-000000000006' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '3602', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '3602' AND i.id = 'a0010000-0000-0000-0000-000000000008' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '281', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '281' AND i.id = 'a0010000-0000-0000-0000-000000000009' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '120', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '120' AND i.id = 'a0010000-0000-0000-0000-000000000010' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN270', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN270' AND i.id = 'a0010000-0000-0000-0000-000000000012' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '136', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '136' AND i.id = 'a0010000-0000-0000-0000-000000000013' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '712', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '712' AND i.id = 'a0010000-0000-0000-0000-000000000014' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN3634', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN3634' AND i.id = 'a0010000-0000-0000-0000-000000000018' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN3641', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN3641' AND i.id = 'a0010000-0000-0000-0000-000000000019' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '956', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '956' AND i.id = 'a0010000-0000-0000-0000-000000000020' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '262', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '262' AND i.id = 'a0010000-0000-0000-0000-000000000021' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN863', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN863' AND i.id = 'a0010000-0000-0000-0000-000000000022' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN3272', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN3272' AND i.id = 'a0010000-0000-0000-0000-000000000023' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '3038', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '3038' AND i.id = 'a0010000-0000-0000-0000-000000000024' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '864', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '864' AND i.id = 'a0010000-0000-0000-0000-000000000026' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '561', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '561' AND i.id = 'a0010000-0000-0000-0000-000000000027' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '118', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '118' AND i.id = 'a0010000-0000-0000-0000-000000000028' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '354', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '354' AND i.id = 'a0010000-0000-0000-0000-000000000030' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '140', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '140' AND i.id = 'a0010000-0000-0000-0000-000000000033' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '433', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '433' AND i.id = 'a0010000-0000-0000-0000-000000000034' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '99PAN3323', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '99PAN3323' AND i.id = 'a0010000-0000-0000-0000-000000000035' AND i.rista_sku IS NULL;
UPDATE items i SET rista_sku = '127', name = m.name, is_active = true, rista_unit = m.unit, rate = m.rate, stock_group = m.stock_group,
  count_frequency = CASE WHEN m.is_critical THEN 'daily' ELSE 'monthly' END
  FROM rista_materials m WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.sku = '127' AND i.id = 'a0010000-0000-0000-0000-000000000036' AND i.rista_sku IS NULL;

--    b) switch off old items that do not exist in Rista (history kept; can be brought back on Items)
UPDATE items SET is_active = false, count_frequency = 'none'
WHERE id IN ('a0010000-0000-0000-0000-000000000007','a0010000-0000-0000-0000-000000000011','a0010000-0000-0000-0000-000000000015','a0010000-0000-0000-0000-000000000016','a0010000-0000-0000-0000-000000000017','a0010000-0000-0000-0000-000000000025','a0010000-0000-0000-0000-000000000029','a0010000-0000-0000-0000-000000000031','a0010000-0000-0000-0000-000000000032','a0010000-0000-0000-0000-000000000037','a0010000-0000-0000-0000-000000000038') AND rista_sku IS NULL;

--    c) add every item on the company audit's critical list that isn't in the app yet
INSERT INTO items (category_id, name, uom, purchase_unit_name, purchase_unit_qty, is_daily_tracked, is_active,
                   rista_sku, rista_unit, rate, count_frequency, stock_group)
SELECT CASE m.stock_group
         WHEN 'Cakes & Pastries' THEN 'ca000000-0000-0000-0000-000000000001'::uuid
         WHEN 'Packaging'        THEN 'ca000000-0000-0000-0000-000000000002'::uuid
         WHEN 'Raw Material'     THEN 'ca000000-0000-0000-0000-000000000003'::uuid
         ELSE 'ca000000-0000-0000-0000-000000000004'::uuid END,
       m.name,
       (CASE WHEN lower(m.unit) IN ('kg','g') THEN 'grams' WHEN lower(m.unit) IN ('lt','ml') THEN 'ml' ELSE 'pieces' END)::item_uom,
       COALESCE(m.unit, 'Nos'), 1, false, true, m.sku, m.unit, m.rate,
       CASE WHEN m.stock_group = 'Packaging' THEN 'fortnightly' ELSE 'daily' END,
       m.stock_group
FROM rista_materials m
WHERE m.brand_id = '11111111-1111-1111-1111-111111111111' AND m.is_critical
  AND NOT EXISTS (SELECT 1 FROM items i JOIN item_categories ic ON ic.id = i.category_id
                  WHERE ic.brand_id = m.brand_id AND i.rista_sku = m.sku);

-- ---------------------------------------------------------------------
-- 3. Month-end full count from Rista's audit file (or any list of SKU + quantity)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_full_count(p_store_id UUID, p_date DATE, p_lines JSONB)
RETURNS JSONB AS $$
DECLARE v_brand UUID; v_saved INTEGER; v_total INTEGER;
BEGIN
  SELECT brand_id INTO v_brand FROM stores WHERE id = p_store_id;
  SELECT count(*) INTO v_total FROM jsonb_array_elements(p_lines);
  INSERT INTO stock_counts (store_id, item_id, count_date, quantity, kind, submitted_by_profile_id)
  SELECT p_store_id, i.id, p_date,
         GREATEST((x->>'qty')::numeric, 0) * public.unit_factor(COALESCE(i.rista_unit, x->>'unit'), i.uom::text),
         'audit', auth.uid()
  FROM jsonb_array_elements(p_lines) x
  JOIN items i ON i.rista_sku = x->>'sku' AND i.is_active
  JOIN item_categories ic ON ic.id = i.category_id AND ic.brand_id = v_brand
  WHERE public.unit_factor(COALESCE(i.rista_unit, x->>'unit'), i.uom::text) IS NOT NULL
    AND COALESCE(i.tare_grams, 0) = 0            -- ice cream boxes are counted in the app
  ON CONFLICT (store_id, item_id, count_date) DO UPDATE SET quantity = EXCLUDED.quantity, kind = 'audit', updated_at = now();
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN jsonb_build_object('saved', v_saved, 'in_file', v_total);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ---------------------------------------------------------------------
-- 4. Company audit reports, to tally against the app
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  last_audit_date DATE NOT NULL,
  audit_date DATE NOT NULL,
  file_name TEXT,
  totals JSONB,                    -- excess / short per group as the company calculated
  submitted_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, audit_date)
);
CREATE TABLE IF NOT EXISTS company_audit_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES company_audits(id) ON DELETE CASCADE,
  sku TEXT NOT NULL, name TEXT, unit TEXT, rate NUMERIC,
  opening NUMERIC, received NUMERIC, transfer_in NUMERIC, transfer_out NUMERIC, wastage NUMERIC,
  sold NUMERIC, system_closing NUMERIC, actual_closing NUMERIC, variance NUMERIC, variance_amount NUMERIC
);
CREATE INDEX IF NOT EXISTS company_audit_lines_audit ON company_audit_lines(audit_id, sku);
ALTER TABLE company_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_audit_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View company audits" ON company_audits;
CREATE POLICY "View company audits" ON company_audits FOR SELECT
  USING (public.is_super_admin() OR public.is_admin() OR public.has_store_access(store_id));
DROP POLICY IF EXISTS "Editors manage company audits" ON company_audits;
CREATE POLICY "Editors manage company audits" ON company_audits FOR ALL USING (public.is_editor()) WITH CHECK (public.is_editor());
DROP POLICY IF EXISTS "View company audit lines" ON company_audit_lines;
CREATE POLICY "View company audit lines" ON company_audit_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM company_audits a WHERE a.id = audit_id
         AND (public.is_super_admin() OR public.is_admin() OR public.has_store_access(a.store_id))));
DROP POLICY IF EXISTS "Editors manage company audit lines" ON company_audit_lines;
CREATE POLICY "Editors manage company audit lines" ON company_audit_lines FOR ALL USING (public.is_editor()) WITH CHECK (public.is_editor());

-- Saves the report and (by default) uses the auditor's actual count as the store's stock count on the audit day,
-- so the app and the company start the next month from the same numbers.
CREATE OR REPLACE FUNCTION public.save_company_audit(
  p_store_id UUID, p_last DATE, p_date DATE, p_file TEXT, p_totals JSONB, p_lines JSONB, p_set_counts BOOLEAN DEFAULT true)
RETURNS JSONB AS $$
DECLARE v_id UUID; v_counts JSONB := '{}'::jsonb;
BEGIN
  DELETE FROM company_audits WHERE store_id = p_store_id AND audit_date = p_date;
  INSERT INTO company_audits (store_id, last_audit_date, audit_date, file_name, totals, submitted_by_profile_id)
  VALUES (p_store_id, p_last, p_date, p_file, p_totals, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO company_audit_lines (audit_id, sku, name, unit, rate, opening, received, transfer_in, transfer_out,
                                   wastage, sold, system_closing, actual_closing, variance, variance_amount)
  SELECT v_id, x->>'sku', x->>'name', x->>'unit', (x->>'rate')::numeric, (x->>'opening')::numeric, (x->>'received')::numeric,
         (x->>'trans_in')::numeric, (x->>'trans_out')::numeric, (x->>'wastage')::numeric, (x->>'sold')::numeric,
         (x->>'system')::numeric, (x->>'actual')::numeric, (x->>'variance')::numeric, (x->>'amount')::numeric
  FROM jsonb_array_elements(p_lines) x;
  IF p_set_counts THEN
    v_counts := public.save_full_count(p_store_id, p_date,
      (SELECT jsonb_agg(jsonb_build_object('sku', x->>'sku', 'qty', x->>'actual', 'unit', x->>'unit')) FROM jsonb_array_elements(p_lines) x));
  END IF;
  RETURN jsonb_build_object('audit_id', v_id) || v_counts;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ---------------------------------------------------------------------
-- 5. The Sept 2026 company audit of 99 Pancakes Borivali East (Borivali Dattapada),
--    25 Aug → 23 Sep, auditor's counts become the 23 Sep stock count
-- ---------------------------------------------------------------------
SELECT public.save_company_audit(
  '33333333-3333-3333-3333-333333333333', '2026-08-25', '2026-09-23', 'Core_Audit_Report_FOFO_Borivali_Dattapada_Sep_26.xlsx',
  '{"cakes_excess": 2649.2655, "cakes_short": -6368.796, "raw_excess": 3015.1757685, "raw_short": -8196.902091, "pack_excess": 1996.0710000000001, "pack_short": -880.5825, "total_excess": 7660.5122685, "total_short": -15446.280591}'::jsonb,
  '[{"sku": "99PAN3264", "name": "Brownie Temptation (1 Kg)", "unit": "nos", "rate": 608.643, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN1140", "name": "Dutch Truffle Cake [1 kg]", "unit": "nos", "rate": 560.595, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN3261", "name": "Nutella Cake (1 Kg)", "unit": "nos", "rate": 694.071, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN1319", "name": "Bake Cheese Cake [500gm]", "unit": "nos", "rate": 300.321, "opening": 1.0, "received": 2.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 1.0, "sold": 1.0, "system": 1.0, "actual": 0.0, "variance": -1.0, "amount": -300.32}, {"sku": "99PAN1131", "name": "Brownie Temptation [500gm]", "unit": "nos", "rate": 293.643, "opening": 1.0, "received": 9.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 7.0, "system": 3.0, "actual": 0.0, "variance": -3.0, "amount": -880.93}, {"sku": "99PAN1170", "name": "Chocolate Fantasy Cake  [500gm]", "unit": "nos", "rate": 222.453, "opening": 0.0, "received": 11.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 4.0, "system": 7.0, "actual": 0.0, "variance": -7.0, "amount": -1557.17}, {"sku": "99PAN626", "name": "Dutch Truffle Cake [500gm]", "unit": "nos", "rate": 266.952, "opening": 3.0, "received": 8.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 4.0, "system": 7.0, "actual": 0.0, "variance": -7.0, "amount": -1868.66}, {"sku": "99PAN3128", "name": "Mona Lisa Cake [500gm]", "unit": "nos", "rate": 347.0355, "opening": 0.0, "received": 6.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 1.0, "sold": 4.0, "system": 1.0, "actual": 0.0, "variance": -1.0, "amount": -347.04}, {"sku": "99PAN1034", "name": "Nutella Cake  [500gm]", "unit": "nos", "rate": 347.0355, "opening": 2.0, "received": 4.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 5.0, "system": 1.0, "actual": 0.0, "variance": -1.0, "amount": -347.04}, {"sku": "99PAN1838", "name": "Pineapple Cake  [500gm]", "unit": "nos", "rate": 266.952, "opening": 1.0, "received": 3.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 1.0, "sold": 2.0, "system": 1.0, "actual": 1.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN1039", "name": "Red Velvet Cake [500gm]", "unit": "nos", "rate": 293.643, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 1.0, "system": -1.0, "actual": 0.0, "variance": 1.0, "amount": 293.64}, {"sku": "99PAN3271", "name": "Brownie Temptation Pastry", "unit": "nos", "rate": 75.6, "opening": 9.0, "received": 18.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 38.0, "system": -11.0, "actual": 2.0, "variance": 13.0, "amount": 982.8}, {"sku": "99PAN389", "name": "Nutella Pastry", "unit": "nos", "rate": 117.453, "opening": 9.0, "received": 8.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 22.0, "system": -5.0, "actual": 0.0, "variance": 5.0, "amount": 587.26}, {"sku": "99PAN1833", "name": "Pineapple Pastry", "unit": "nos", "rate": 64.26, "opening": 8.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 14.0, "system": -6.0, "actual": 0.0, "variance": 6.0, "amount": 385.56}, {"sku": "99PAN3686", "name": "Chocolate Marquies Pastry (95gm) 9pcs", "unit": "nos", "rate": 119.7, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN3685", "name": "Orange Chocolate Cheese Cake Pastry (100gm) 9 pcs", "unit": "nos", "rate": 116.55, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN1041", "name": "Apple Cinnemon Pie", "unit": "nos", "rate": 80.0835, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 0.0, "actual": 0.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN2567", "name": "Hot chocolate Bomb (9 pcs)", "unit": "nos", "rate": 79.9995, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 5.0, "system": -5.0, "actual": 0.0, "variance": 5.0, "amount": 400.0}, {"sku": "99PAN1133", "name": "Hot Chocolate Planter", "unit": "nos", "rate": 53.382, "opening": 5.0, "received": 48.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 17.0, "system": 36.0, "actual": 16.0, "variance": -20.0, "amount": -1067.64}, {"sku": "99PAN2325", "name": "Brownie Brittle Chips Almond", "unit": "nos", "rate": 69.3, "opening": 12.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 12.0, "system": 0.0, "actual": 5.0, "variance": 5.0, "amount": 346.5}, {"sku": "99PAN2327", "name": "Brownie Brittle Chips Coffee", "unit": "nos", "rate": 68.25, "opening": 4.0, "received": 12.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 4.0, "system": 12.0, "actual": 12.0, "variance": 0.0, "amount": 0.0}, {"sku": "99PAN2326", "name": "Brownie Brittle Chips Pistachio", "unit": "nos", "rate": 68.25, "opening": 0.0, "received": 12.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 6.0, "system": 6.0, "actual": 7.0, "variance": 1.0, "amount": 68.25}, {"sku": "99PAN2328", "name": "Brownie Brittle Chips Strawberry", "unit": "nos", "rate": 68.25, "opening": 0.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 7.0, "system": -7.0, "actual": 0.0, "variance": 7.0, "amount": 477.75}, {"sku": "99PANNM19", "name": "Biscoff Macaron", "unit": "nos", "rate": 22.2495, "opening": 18.0, "received": 18.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 34.0, "system": 2.0, "actual": 12.0, "variance": 10.0, "amount": 222.5}, {"sku": "99PANNM43", "name": "Orange Chocolate Macaron", "unit": "nos", "rate": 22.2495, "opening": 23.0, "received": 18.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 18.0, "system": 23.0, "actual": 21.0, "variance": -2.0, "amount": -44.5}, {"sku": "99PANNM01", "name": "Bubblegum Macaron", "unit": "nos", "rate": 22.2495, "opening": 30.0, "received": 18.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 28.0, "system": 20.0, "actual": 17.0, "variance": -3.0, "amount": -66.75}, {"sku": "99PANNM25", "name": "Dark Chocolate Macaron", "unit": "nos", "rate": 22.2495, "opening": 25.0, "received": 18.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 34.0, "system": 9.0, "actual": 19.0, "variance": 10.0, "amount": 222.5}, {"sku": "99PANNM13", "name": "Nutella Macaron", "unit": "nos", "rate": 22.2495, "opening": 9.0, "received": 36.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 53.0, "system": -8.0, "actual": 13.0, "variance": 21.0, "amount": 467.24}, {"sku": "99PANNM31", "name": "Strawberry Cheese Cake Macaron", "unit": "nos", "rate": 22.2495, "opening": 15.0, "received": 36.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 36.0, "system": 15.0, "actual": 24.0, "variance": 9.0, "amount": 200.25}, {"sku": "99PAN514", "name": "Bisleri Vedica Water Bottle 500ml (20 pcs)", "unit": "nos", "rate": 15.75, "opening": 6.0, "received": 40.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 15.0, "system": 31.0, "actual": 8.0, "variance": -23.0, "amount": -362.25}, {"sku": "253", "name": "Oil Sunflower", "unit": "KG", "rate": 155.001, "opening": 7.234, "received": 12.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 6.598, "system": 12.636000000000003, "actual": 8.381, "variance": -4.255000000000003, "amount": -659.53}, {"sku": "257", "name": "Miracle Premix (1 kg)", "unit": "KG", "rate": 294.525, "opening": 25.638, "received": 50.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 42.793, "system": 32.845000000000006, "actual": 27.788, "variance": -5.057000000000006, "amount": -1489.41}, {"sku": "956", "name": "Red Velvet Premix (250 gm)", "unit": "KG", "rate": 210, "opening": 0.33, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 1.757, "system": -1.4269999999999998, "actual": 0.0, "variance": 1.4269999999999998, "amount": 299.67}, {"sku": "126", "name": "Milk Tetra Pack", "unit": "PKT", "rate": 75.5265, "opening": 9.786, "received": 36.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 42.684, "system": 3.102000000000004, "actual": 9.181, "variance": 6.078999999999995, "amount": 459.13}, {"sku": "123", "name": "Nutella", "unit": "KG", "rate": 587.286, "opening": 13.763, "received": 18.0, "trans_in": 0.0, "trans_out": 3.0, "wastage": 0.0, "sold": 15.46, "system": 13.302999999999997, "actual": 9.577, "variance": -3.7259999999999973, "amount": -2188.23}, {"sku": "1288", "name": "Milk Chocolate Filling", "unit": "KG", "rate": 340.725, "opening": 15.253, "received": 8.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 4.884, "system": 18.369, "actual": 15.34, "variance": -3.029, "amount": -1032.06}, {"sku": "353", "name": "Dark Chocolate Filling", "unit": "KG", "rate": 406.875, "opening": 5.422, "received": 24.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 14.134, "system": 15.288, "actual": 9.502, "variance": -5.786, "amount": -2354.18}, {"sku": "150", "name": "White Chocolate Fillings", "unit": "KG", "rate": 340.725, "opening": 3.27, "received": 8.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 4.713, "system": 6.5569999999999995, "actual": 6.84, "variance": 0.28300000000000036, "amount": 96.43}, {"sku": "99PAN270", "name": "Brownie Slab", "unit": "1 kg", "rate": 430.5, "opening": 0.0, "received": 2.16, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 1.85, "system": 0.31000000000000005, "actual": 0.67, "variance": 0.36, "amount": 154.98}, {"sku": "587", "name": "Cone Paper(Waffle)", "unit": "nos", "rate": 2.205, "opening": 298.0, "received": 400.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 490.0, "system": 208.0, "actual": 271.0, "variance": 63.0, "amount": 138.91}, {"sku": "157", "name": "Tray 6 Pcs", "unit": "nos", "rate": 3.276, "opening": 242.0, "received": 300.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 414.0, "system": 128.0, "actual": 378.0, "variance": 250.0, "amount": 819.0}, {"sku": "158", "name": "Tray 12 Pcs", "unit": "nos", "rate": 4.368, "opening": 326.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 106.0, "system": 220.0, "actual": 282.0, "variance": 62.0, "amount": 270.82}, {"sku": "379", "name": "Parcel Box (12PC)", "unit": "nos", "rate": 4.9612, "opening": 212.0, "received": 200.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 112.0, "system": 300.0, "actual": 225.0, "variance": -75.0, "amount": -372.09}, {"sku": "383", "name": "Parcel Box ( 6 Pcs )", "unit": "nos", "rate": 3.675, "opening": 390.0, "received": 200.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 273.0, "system": 317.0, "actual": 302.0, "variance": -15.0, "amount": -55.12}, {"sku": "747", "name": "Bottle with Lid 350ml PLA", "unit": "nos", "rate": 13.23, "opening": 1.0, "received": 100.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 103.0, "system": -2.0, "actual": 56.0, "variance": 58.0, "amount": 767.34}, {"sku": "99PAN3350", "name": "Mini Cone Paper Waffle", "unit": "nos", "rate": 1.6538, "opening": 358.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 96.0, "system": 262.0, "actual": 165.0, "variance": -97.0, "amount": -160.41}, {"sku": "99PAN3349", "name": "Waffle 4pc Box", "unit": "nos", "rate": 9.765, "opening": 50.0, "received": 50.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 24.0, "system": 76.0, "actual": 46.0, "variance": -30.0, "amount": -292.95}, {"sku": "3603", "name": "Waffle Cake Box", "unit": "nos", "rate": 10.8675, "opening": 23.0, "received": 0.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 3.0, "system": 20.0, "actual": 20.0, "variance": 0.0, "amount": 0.0}, {"sku": "3418", "name": "Paper Tub With Lid (500 ML)", "unit": "nos", "rate": 11.21, "opening": 2.0, "received": 50.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 52.0, "actual": 29.0, "variance": -23.0, "amount": -257.83}, {"sku": "443", "name": "Shake Glass With Lid (500ML)", "unit": "nos", "rate": 9.35, "opening": 20.0, "received": 50.0, "trans_in": 0.0, "trans_out": 0.0, "wastage": 0.0, "sold": 0.0, "system": 70.0, "actual": 52.0, "variance": -18.0, "amount": -168.3}]'::jsonb);

-- ---------------------------------------------------------------------
-- 6. Transfers between stores (the company audit has Trans In / Trans Out)
-- ---------------------------------------------------------------------
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS movement TEXT NOT NULL DEFAULT 'received';
DO $$ BEGIN
  ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_movement_check
    CHECK (movement IN ('received', 'transfer_in', 'transfer_out'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Report: received = received + transfer in − transfer out
DROP FUNCTION IF EXISTS public.stock_variance_report(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.stock_variance_report(p_store_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (
  item_id UUID, item_name TEXT, stock_group TEXT, uom TEXT, rista_unit TEXT, count_frequency TEXT,
  rista_sku TEXT, rate NUMERIC,
  opening_date DATE, opening NUMERIC, received NUMERIC, wastage NUMERIC, used NUMERIC,
  system_closing NUMERIC, closing_date DATE, actual_closing NUMERIC,
  variance NUMERIC, variance_percent NUMERIC, variance_amount NUMERIC,
  days INTEGER, days_with_sales_data INTEGER, status TEXT
) AS $$
DECLARE v_brand UUID;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.has_store_access(p_store_id)) THEN
    RAISE EXCEPTION 'Not allowed to view this store';
  END IF;
  SELECT s.brand_id INTO v_brand FROM stores s WHERE s.id = p_store_id;

  RETURN QUERY
  WITH it AS (
    SELECT i.id, i.name::TEXT AS name, COALESCE(i.stock_group, ic.name)::TEXT AS grp, i.uom::TEXT AS uom,
           i.rista_unit, i.count_frequency, i.rista_sku, i.rate
    FROM items i JOIN item_categories ic ON ic.id = i.category_id
    WHERE ic.brand_id = v_brand AND i.is_active
  ),
  closing AS (                                  -- latest count on/before p_to
    SELECT DISTINCT ON (sc.item_id) sc.item_id, sc.count_date, sc.quantity
    FROM stock_counts sc WHERE sc.store_id = p_store_id AND sc.count_date <= p_to
    ORDER BY sc.item_id, sc.count_date DESC
  ),
  opening AS (                                  -- the count the period starts from
    SELECT DISTINCT ON (sc.item_id) sc.item_id, sc.count_date, sc.quantity
    FROM stock_counts sc JOIN closing c ON c.item_id = sc.item_id
    WHERE sc.store_id = p_store_id
      AND sc.count_date < c.count_date
      AND (p_from IS NULL OR sc.count_date <= p_from)
    ORDER BY sc.item_id, sc.count_date DESC
  ),
  win AS (
    SELECT it.*, o.count_date AS od, o.quantity AS oq, c.count_date AS cd, c.quantity AS cq
    FROM it JOIN closing c ON c.item_id = it.id JOIN opening o ON o.item_id = it.id
  ),
  rec AS (
    SELECT w.id, SUM(CASE WHEN po.movement = 'transfer_out' THEN -po.quantity ELSE po.quantity END) AS q FROM win w
    JOIN purchase_orders po ON po.item_id = w.id AND po.store_id = p_store_id
     AND po.entry_date > w.od AND po.entry_date <= w.cd
    GROUP BY w.id
  ),
  wst AS (
    SELECT w.id, SUM(dw.quantity_wasted) AS q FROM win w
    JOIN daily_wastage_log dw ON dw.item_id = w.id AND dw.store_id = p_store_id
     AND dw.entry_date > w.od AND dw.entry_date <= w.cd
    GROUP BY w.id
  ),
  ups AS (                                      -- uploads fully inside each item's window
    SELECT w.id AS wid, u.id AS uid, u.date_from, u.date_to FROM win w
    JOIN rista_consumption_uploads u ON u.store_id = p_store_id
     AND u.date_from > w.od AND u.date_to <= w.cd
  ),
  covered AS (
    SELECT wid, SUM(date_to - date_from + 1)::INTEGER AS d FROM ups GROUP BY wid
  ),
  usedq AS (
    SELECT w.id,
           SUM(l.ideal_qty * public.unit_factor(l.unit, w.uom)) AS q,
           bool_or(public.unit_factor(l.unit, w.uom) IS NULL) AS bad_unit,
           MAX(l.rate) FILTER (WHERE l.rate IS NOT NULL) AS r
    FROM win w JOIN ups ON ups.wid = w.id
    JOIN rista_consumption_lines l ON l.upload_id = ups.uid AND l.sku = w.rista_sku
    GROUP BY w.id
  ),
  calc AS (
    SELECT w.*, COALESCE(rec.q, 0) AS rq, COALESCE(wst.q, 0) AS wq, COALESCE(u.q, 0) AS uq,
           COALESCE(u.bad_unit, false) AS bad_unit,
           COALESCE(w.rate, u.r) AS rt,
           COALESCE(public.unit_factor(COALESCE(w.rista_unit, 'nos'), w.uom), 1) AS f,
           (w.cd - w.od)::INTEGER AS d, COALESCE(cv.d, 0) AS dc
    FROM win w
    LEFT JOIN rec ON rec.id = w.id LEFT JOIN wst ON wst.id = w.id
    LEFT JOIN usedq u ON u.id = w.id LEFT JOIN covered cv ON cv.wid = w.id
  )
  SELECT c.id, c.name, c.grp, c.uom, c.rista_unit, c.count_frequency, c.rista_sku, c.rt,
         c.od, c.oq, c.rq, c.wq, ROUND(c.uq, 3),
         ROUND(c.oq + c.rq - c.wq - c.uq, 3) AS system_closing,
         c.cd, c.cq,
         ROUND(c.cq - (c.oq + c.rq - c.wq - c.uq), 3) AS variance,
         CASE WHEN c.uq > 0 THEN ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.uq * 100, 1) END,
         -- ₹: variance is in app unit; rate is per Rista unit
         ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.f * COALESCE(c.rt, 0), 2) AS variance_amount,
         c.d, c.dc,
         (CASE
            WHEN c.rista_sku IS NULL THEN 'NO_SKU'                 -- can't know sales use
            WHEN c.bad_unit THEN 'UNIT_MISMATCH'
            WHEN c.dc < c.d THEN 'SALES_DATA_MISSING'              -- some days have no Rista upload
            WHEN c.oq + c.rq - c.wq - c.uq < 0 THEN 'CHECK_RECEIVED'  -- system stock below zero: delivery not entered?
            WHEN c.cq - (c.oq + c.rq - c.wq - c.uq) < 0 THEN 'SHORT'
            WHEN c.cq - (c.oq + c.rq - c.wq - c.uq) > 0 THEN 'EXCESS'
            ELSE 'OK'
          END)::TEXT
  FROM calc c
  ORDER BY ABS(ROUND((c.cq - (c.oq + c.rq - c.wq - c.uq)) / c.f * COALESCE(c.rt, 0), 2)) DESC, c.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
