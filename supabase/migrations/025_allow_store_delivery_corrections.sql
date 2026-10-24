-- ==========================================================
-- 025_allow_store_delivery_corrections.sql
-- Allow Admin and Super Admin to manage purchase orders
-- (stock received / transfers) across any date (past & present).
-- Store logins remain restricted to their active store and current shift.
-- ==========================================================

DROP POLICY IF EXISTS "Editors manage purchase_orders" ON purchase_orders;
CREATE POLICY "Editors manage purchase_orders" ON purchase_orders FOR ALL
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_active AND (role IN ('admin', 'super_admin') OR can_edit = true)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_active AND (role IN ('admin', 'super_admin') OR can_edit = true)
    )
  );

DROP POLICY IF EXISTS "Manage purchase orders for accessed stores" ON purchase_orders;
CREATE POLICY "Manage purchase orders for accessed stores" ON purchase_orders FOR ALL
  USING (public.store_can_write(store_id, entry_date))
  WITH CHECK (public.store_can_write(store_id, entry_date));
