# BRP Store Operations & Stock Variance Intelligence Platform - Full Handoff Context Document

> **Purpose**: This document provides 100% complete architecture, database schema, business rules, route sitemaps, POS parser details, and workflow context for developer handoff and seamless continuation.

---

## 1. Project & Business Overview

The **BRP Store Operations & Stock Variance Intelligence Platform** is a multi-store SaaS application designed for managing operations, cash tallies, stock entries, Rista POS sales uploads, and stock variance intelligence across **4 stores and 2 brands** in Mumbai, India:

### Brands & Stores:
1. **99 Pancakes** (Brand ID: `11111111-1111-1111-1111-111111111111`):
   - **Borivali East**: Code `99-BVE`, Store ID `33333333-3333-3333-3333-333333333333`
   - **Andheri West**: Code `99-ANW`, Store ID `44444444-4444-4444-4444-444444444444`
2. **Baskin Robbins** (Brand ID: `22222222-2222-2222-2222-222222222222`):
   - **Borivali West**: Code `BR-BVW`, Store ID `55555555-5555-5555-5555-555555555555`
   - **Kandivali West**: Code `BR-KDW`, Store ID `66666666-6666-6666-6666-666666666666`

---

## 2. Technical Stack & System Architecture

- **Frontend Framework**: Next.js 14 / 16 (App Router, Turbopack, TypeScript).
- **Styling**: Dark-mode glassmorphic design system (`src/app/globals.css`) with modular component CSS modules (`*.module.css`). Accent color `#ff6b35` (99 Pancakes orange) and `#e91e8c` (Baskin Robbins pink).
- **Database & Auth**: Live Supabase PostgreSQL instance with Row Level Security (RLS) policies and database RPC functions.
  > ⚠️ **IMPORTANT FOR OTHER AI SESSIONS**: The Supabase database is ALREADY LIVE and fully seeded with all 30+ recipes, stores, items, and RPC functions. **Do NOT run SQL migrations or reset the database**. All code changes simply use the existing live Supabase connection via environment variables in `.env.local`.
- **POS Integration**: Client-side Rista POS CSV/XLSX parser (`src/lib/services/rista-parser.ts`) supporting both Hourly Sales export summaries and Itemized Product Sales reports.

---

## 3. Database Schema & Migration Files

All SQL migration scripts are located in `/supabase/migrations/`:

### `001_initial_schema.sql`: Core Database Tables
- **`brands`**: `id`, `name`, `code`.
- **`stores`**: `id`, `brand_id`, `name`, `location`, `code`, `is_active`.
- **`profiles`**: `id` (references `auth.users`), `role` (`'store'`, `'admin'`, `'super_admin'`), `full_name`, `email`, `store_access` (`uuid[]`), `is_active`.
- **`staff_members`**: `id`, `store_id`, `name`, `email`, `phone`, `profile_id`, `is_active`.
- **`item_categories`**: `id`, `brand_id`, `name`, `sort_order`.
- **`items`**: `id`, `category_id`, `name`, `uom` (`grams`, `ml`, `pieces`), `purchase_unit_name`, `purchase_unit_qty`, `is_daily_tracked`, `is_active`.
- **`recipes`**: `id`, `brand_id`, `product_name`, `product_category`.
- **`recipe_ingredients`**: `id`, `recipe_id`, `item_id`, `quantity`, `notes`.
- **`daily_stock_entries`**: `id`, `store_id`, `item_id`, `entry_date`, `opening_stock`, `closing_stock`, `staff_member_id`, `submitted_by_profile_id`. Unique on `(store_id, item_id, entry_date)`.
- **`daily_tally_cash` / `daily_cash_tally`**: Denomination counts (₹2000, ₹500, ₹200, ₹100, ₹50, ₹20, ₹10, ₹5, ₹2, ₹1) auto-calculating total cash amount for morning/evening shifts.
- **`daily_sales_summary`**: `gross_sales`, `net_sales`, `total_discount`, `total_tax`, `total_orders`, `cash_amount`, `upi_amount`, `card_amount`, `swiggy_amount`, `zomato_amount`.
- **`daily_sales_items`**: Itemized sales records (`item_name`, `quantity_sold`, `unit_price`, `total_price`).
- **`daily_wastage_log`**: Logged raw material wastage with reasons (`spilled`, `expired`, `dropped`, `burnt`, `other`).
- **`variance_thresholds`**: Item/category variance tolerance threshold % (default: `5.0%`).

### `002_phase2_variance.sql`: 30+ Recipe BOM Seeds & Variance RPC
- Seeds all raw materials (Batter, Nutella, Fillings, Toppings, Spreads, Ice Cream base).
- Seeds **30+ Master Recipes** (Holland Pancakes 12pc & 6pc, Waffles, Crepes, BR Scoops 82g/125g/164g, Home Packs 347g/487g/695g).
- PostgreSQL Function `calculate_daily_variance(p_store_id UUID, p_date DATE)`:
  - Compares Actual Consumption (`opening_stock - closing_stock`) against Theoretical Consumption (`SUM(POS quantity_sold * recipe_ingredient.quantity)`), subtracting logged wastage and tasting.
  - Applies **Brand Isolation**: Filters items by active store brand `(ic.brand_id IS NULL OR ic.brand_id = v_brand_id)` so 99 Pancakes stores do not evaluate Baskin Robbins items and vice versa.

### `003_staff_login_flow.sql`: Staff Roster Schema Enhancement
- Adds `email`, `phone`, and `profile_id` columns to `staff_members` table.

---

## 4. Complete Application Sitemap & Route Guide (20 Routes)

### Auth Routes:
- `/login`: User authentication with role-based redirection (`super_admin` -> `/super-admin/variance`, `admin` -> `/analytics/sales`, `store` -> `/store`).
- `/reset-password`: Password reset flow.

### Store Portal Routes (`/store`):
- `/store`: Daily Store Operations Checklist (status of morning cash, opening stock, evening cash, closing stock, sales upload).
- `/store/stock-entry`: Opening & Closing stock entry with staff roster selection, UOM badges, auto-calculated consumption.
- `/store/cash-tally`: Morning & Evening cash denomination counter with subtotal calculations.
- `/store/sales-upload`: Dropzone for Rista POS CSV sales reports with real-time summary breakdown.
- `/store/wastage`: Daily wastage logging table & form.
- `/store/eod-report`: End-Of-Day store summary printable / PDF layout.

### Super Admin Console Routes (`/super-admin`):
- `/super-admin/variance`: Real-time stock variance audit table with status badges (`✓ OK` vs `⚠ Exceeded`), KPI stat cards, and POS recipe breakdown modal.
- `/super-admin/variance/thresholds`: Threshold configuration table per item/category.
- `/super-admin/recipes`: Interactive Recipe & BOM Builder with inline grammage editing, item addition/removal, recipe creation/deletion.
- `/super-admin/items`: Raw material item catalog (daily tracked toggle, UOM, category, active status).
- `/super-admin/users`: Roster Staff Members management + System User Account registration (Store, Admin, Super Admin).

### Analytics Routes (`/analytics`):
- `/analytics/sales`: Gross/Net revenue metrics, payment splits (UPI, Cash, Card, Swiggy, Zomato), order count, AOV.
- `/analytics/trends`: Multi-day sales comparison charts.

---

## 5. Domain Rules & Business Logic

1. **System Roles**:
   - `store`: Store-level user account (access restricted to assigned store IDs).
   - `admin`: Admin account.
   - `super_admin`: Super Admin with full access across all stores and management pages.
2. **Staff Members vs User Accounts**:
   - Staff Members (`staff_members`) are shift roster workers selected in dropdowns during daily entries.
   - User Accounts (`profiles` + Supabase Auth) are system login accounts.
3. **Brand-Isolated Variance**:
   - 99 Pancakes stores audit Pancake/Waffle raw materials (Batter, Nutella, Sauces).
   - Baskin Robbins stores audit Ice Cream tubs & cones.

---

## 6. How to Run & Verify

1. **Local Development**:
   ```bash
   npm run dev
   ```
2. **Production Build Verification**:
   ```bash
   npm run build
   ```
3. **Database Connection**:
   No database migration or setup is required. All code changes automatically interface with the existing live Supabase backend configured in `.env.local`.
