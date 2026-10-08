-- =====================================================================
-- 012_br_settings.sql — Baskin Robbins: skip words & brand settings
-- =====================================================================
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
