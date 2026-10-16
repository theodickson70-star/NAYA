-- 0.19.1 Ruhusa ya NAYA Staff kwenye akaunti iliyopo (mf. dereva aliyekwisha jisajili).
-- Akaunti moja kwa namba moja: badala ya akaunti mpya, akaunti ya USER inapewa ruhusa ya staff.
-- Inaongeza safu tu; haibadilishi wala kufuta data iliyopo.
--   staff_access: NULL = si staff · 'ACTIVE' = ana ruhusa · 'SUSPENDED' = ruhusa imesimamishwa (akaunti yake inaendelea)
ALTER TABLE naya.users ADD COLUMN IF NOT EXISTS staff_access varchar(10)
  CHECK (staff_access IS NULL OR staff_access IN ('ACTIVE', 'SUSPENDED'));
ALTER TABLE naya.users ADD COLUMN IF NOT EXISTS staff_since timestamptz;
ALTER TABLE naya.users ADD COLUMN IF NOT EXISTS staff_added_by uuid REFERENCES naya.users(id);
CREATE INDEX IF NOT EXISTS users_staff_access_idx ON naya.users (staff_access) WHERE staff_access IS NOT NULL;
