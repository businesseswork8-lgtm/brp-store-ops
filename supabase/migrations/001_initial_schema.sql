-- ==========================================
-- 001_initial_schema.sql
-- Multi-store operations dashboard schema
-- For 99 Pancakes and Baskin Robbins
-- ==========================================

-- ==========================================
-- 1. Enums
-- ==========================================
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'store');
CREATE TYPE item_uom AS ENUM ('grams', 'ml', 'pieces');
CREATE TYPE wastage_reason AS ENUM ('spilled', 'expired', 'dropped', 'burnt', 'other');
CREATE TYPE tally_type AS ENUM ('morning', 'evening');

-- ==========================================
-- 2. Tables
-- ==========================================

-- brands
CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- stores
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    code TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profiles
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'store',
    full_name TEXT,
    email TEXT,
    store_access UUID[] DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff_members
CREATE TABLE staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- item_categories
CREATE TABLE item_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE, -- null means shared
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- items
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    uom item_uom NOT NULL,
    purchase_unit_name TEXT NOT NULL,
    purchase_unit_qty NUMERIC NOT NULL,
    is_daily_tracked BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- recipes
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name TEXT NOT NULL,
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- recipe_ingredients
CREATE TABLE recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- daily_stock_entries
CREATE TABLE daily_stock_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    opening_stock NUMERIC NOT NULL,
    closing_stock NUMERIC NOT NULL,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, item_id, entry_date)
);

-- daily_wastage_log
CREATE TABLE daily_wastage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    quantity_wasted NUMERIC NOT NULL,
    reason wastage_reason NOT NULL,
    reason_notes TEXT,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- daily_tasting_log
CREATE TABLE daily_tasting_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    tasting_spoons INTEGER NOT NULL,
    estimated_grams NUMERIC GENERATED ALWAYS AS (tasting_spoons * 15) STORED,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- daily_cash_tally
CREATE TABLE daily_cash_tally (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    tally_type tally_type NOT NULL,
    denomination_2000 INTEGER NOT NULL DEFAULT 0,
    denomination_500 INTEGER NOT NULL DEFAULT 0,
    denomination_200 INTEGER NOT NULL DEFAULT 0,
    denomination_100 INTEGER NOT NULL DEFAULT 0,
    denomination_50 INTEGER NOT NULL DEFAULT 0,
    denomination_20 INTEGER NOT NULL DEFAULT 0,
    denomination_10 INTEGER NOT NULL DEFAULT 0,
    denomination_5 INTEGER NOT NULL DEFAULT 0,
    denomination_2 INTEGER NOT NULL DEFAULT 0,
    denomination_1 INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC GENERATED ALWAYS AS (
        (denomination_2000 * 2000) + (denomination_500 * 500) +
        (denomination_200 * 200) + (denomination_100 * 100) +
        (denomination_50 * 50) + (denomination_20 * 20) +
        (denomination_10 * 10) + (denomination_5 * 5) +
        (denomination_2 * 2) + denomination_1
    ) STORED,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, entry_date, tally_type)
);

-- daily_sales_summary
CREATE TABLE daily_sales_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    gross_sales NUMERIC NOT NULL,
    net_sales NUMERIC NOT NULL,
    total_discount NUMERIC NOT NULL,
    total_tax NUMERIC NOT NULL,
    total_orders INTEGER NOT NULL,
    cash_amount NUMERIC NOT NULL,
    upi_amount NUMERIC NOT NULL,
    card_amount NUMERIC NOT NULL,
    swiggy_amount NUMERIC NOT NULL,
    zomato_amount NUMERIC NOT NULL,
    other_online_amount NUMERIC NOT NULL,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    raw_file_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, entry_date)
);

-- daily_sales_items
CREATE TABLE daily_sales_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_summary_id UUID NOT NULL REFERENCES daily_sales_summary(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    quantity_sold INTEGER NOT NULL,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- purchase_orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    quantity NUMERIC NOT NULL,
    supplier_name TEXT,
    po_reference TEXT,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- variance_thresholds
CREATE TABLE variance_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    category_id UUID REFERENCES item_categories(id) ON DELETE CASCADE,
    threshold_percent NUMERIC NOT NULL DEFAULT 5.0,
    updated_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- monthly_audit_entries
CREATE TABLE monthly_audit_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    audit_month DATE NOT NULL,
    quantity NUMERIC NOT NULL,
    staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
    submitted_by_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, item_id, audit_month)
);

-- ==========================================
-- 3. Triggers & Functions
-- ==========================================

-- Function to handle updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_stock_entries_updated_at
    BEFORE UPDATE ON daily_stock_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_variance_thresholds_updated_at
    BEFORE UPDATE ON variance_thresholds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to handle auto-creating user profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        'store'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- 4. Row Level Security (RLS)
-- ==========================================

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_wastage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_tasting_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_cash_tally ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE variance_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_audit_entries ENABLE ROW LEVEL SECURITY;

-- Helper functions for policies
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_store_access(check_store_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND check_store_id = ANY(store_access)
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles Policies
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Super admin has full access to profiles" ON profiles FOR ALL USING (public.is_super_admin());
CREATE POLICY "Admins can read all profiles" ON profiles FOR SELECT USING (public.is_admin());

-- Brands Policies (Public read for authenticated, super_admin write)
CREATE POLICY "Brands are viewable by all authenticated users" ON brands FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Super admin can modify brands" ON brands FOR ALL USING (public.is_super_admin());

-- Stores Policies
CREATE POLICY "Users can view stores they have access to" ON stores FOR SELECT USING (public.is_super_admin() OR public.has_store_access(id));
CREATE POLICY "Super admin can modify stores" ON stores FOR ALL USING (public.is_super_admin());

-- General Shared Tables (Item Categories, Items, Recipes, etc. - viewable by those with any store access or admin/superadmin)
CREATE POLICY "Item categories viewable by authenticated users" ON item_categories FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Super admin modify item categories" ON item_categories FOR ALL USING (public.is_super_admin());

CREATE POLICY "Items viewable by authenticated users" ON items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Super admin modify items" ON items FOR ALL USING (public.is_super_admin());

CREATE POLICY "Recipes viewable by authenticated users" ON recipes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Super admin modify recipes" ON recipes FOR ALL USING (public.is_super_admin());

CREATE POLICY "Recipe ingredients viewable by authenticated users" ON recipe_ingredients FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Super admin modify recipe ingredients" ON recipe_ingredients FOR ALL USING (public.is_super_admin());

-- Store specific data policies (Staff, Daily Stock, Wastage, Sales, etc.)
-- staff_members
CREATE POLICY "View staff for accessed stores" ON staff_members FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage staff for accessed stores" ON staff_members FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_stock_entries
CREATE POLICY "View stock entries for accessed stores" ON daily_stock_entries FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage stock entries for accessed stores" ON daily_stock_entries FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_wastage_log
CREATE POLICY "View wastage log for accessed stores" ON daily_wastage_log FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage wastage log for accessed stores" ON daily_wastage_log FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_tasting_log
CREATE POLICY "View tasting log for accessed stores" ON daily_tasting_log FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage tasting log for accessed stores" ON daily_tasting_log FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_cash_tally
CREATE POLICY "View cash tally for accessed stores" ON daily_cash_tally FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage cash tally for accessed stores" ON daily_cash_tally FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_sales_summary
CREATE POLICY "View sales summary for accessed stores" ON daily_sales_summary FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage sales summary for accessed stores" ON daily_sales_summary FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- daily_sales_items
CREATE POLICY "View sales items for accessed stores" ON daily_sales_items FOR SELECT USING (
    public.is_super_admin() OR 
    EXISTS (SELECT 1 FROM daily_sales_summary dss WHERE dss.id = sales_summary_id AND public.has_store_access(dss.store_id))
);
CREATE POLICY "Manage sales items for accessed stores" ON daily_sales_items FOR ALL USING (
    public.is_super_admin() OR 
    EXISTS (SELECT 1 FROM daily_sales_summary dss WHERE dss.id = sales_summary_id AND public.has_store_access(dss.store_id))
);

-- purchase_orders
CREATE POLICY "View purchase orders for accessed stores" ON purchase_orders FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage purchase orders for accessed stores" ON purchase_orders FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- variance_thresholds
CREATE POLICY "View variance thresholds" ON variance_thresholds FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Manage variance thresholds" ON variance_thresholds FOR ALL USING (public.is_super_admin() OR public.is_admin());

-- monthly_audit_entries
CREATE POLICY "View monthly audits for accessed stores" ON monthly_audit_entries FOR SELECT USING (public.is_super_admin() OR public.has_store_access(store_id));
CREATE POLICY "Manage monthly audits for accessed stores" ON monthly_audit_entries FOR ALL USING (public.is_super_admin() OR public.has_store_access(store_id));

-- ==========================================
-- 5. Seed Data
-- ==========================================

-- Brands
INSERT INTO brands (id, name, code) VALUES
    ('11111111-1111-1111-1111-111111111111', '99 Pancakes', '99P'),
    ('22222222-2222-2222-2222-222222222222', 'Baskin Robbins', 'BR')
ON CONFLICT (code) DO NOTHING;

-- Stores
INSERT INTO stores (id, brand_id, name, location, code) VALUES
    ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '99 Pancakes Borivali East', 'Borivali East', '99-BVE'),
    ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '99 Pancakes Andheri West', 'Andheri West', '99-ANW'),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'Baskin Robbins Borivali West', 'Borivali West', 'BR-BVW'),
    ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Baskin Robbins Kandivali West', 'Kandivali West', 'BR-KDW')
ON CONFLICT (code) DO NOTHING;

-- Item Categories
INSERT INTO item_categories (id, brand_id, name, sort_order) VALUES
    ('77777777-7777-7777-7777-777777777771', '11111111-1111-1111-1111-111111111111', 'Batter', 1),
    ('77777777-7777-7777-7777-777777777772', '11111111-1111-1111-1111-111111111111', 'Filling', 2),
    ('77777777-7777-7777-7777-777777777773', '11111111-1111-1111-1111-111111111111', 'Topping', 3),
    ('77777777-7777-7777-7777-777777777774', '22222222-2222-2222-2222-222222222222', 'Ice Cream Flavor', 1),
    ('77777777-7777-7777-7777-777777777775', '22222222-2222-2222-2222-222222222222', 'Specialty', 2),
    ('77777777-7777-7777-7777-777777777776', NULL, 'Spread', 4)
ON CONFLICT (id) DO NOTHING;

-- Variance Thresholds (Default 5%)
INSERT INTO variance_thresholds (item_id, category_id, threshold_percent) VALUES
    (NULL, NULL, 5.0)
ON CONFLICT (id) DO NOTHING;
