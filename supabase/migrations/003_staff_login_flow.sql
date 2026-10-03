-- Migration 003: Enhance staff_members with email, phone, and profile link for seamless login flow
ALTER TABLE staff_members 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_members_email ON staff_members(email);
CREATE INDEX IF NOT EXISTS idx_staff_members_profile ON staff_members(profile_id);
