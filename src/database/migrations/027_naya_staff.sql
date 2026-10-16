-- 0.19.0 NAYA Staff: wasaidizi wanaoingia kwenye app ya NAYA kusajili bodaboda na kupendekeza maeneo.
-- Inaongeza cheo kipya, safu na index tu; haibadilishi wala kufuta data iliyopo.
ALTER TYPE naya.user_role ADD VALUE IF NOT EXISTS 'STAFF';

-- Password ya muda (iliyotolewa na ofisi au staff) → mtumiaji anaibadilisha akiingia mara ya kwanza.
ALTER TABLE naya.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
-- Aliyetengeneza akaunti hii (ofisi kwa staff; staff kwa dereva). NULL = alijisajili mwenyewe.
ALTER TABLE naya.users ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES naya.users(id);

-- Dereva aliyesajiliwa na NAYA Staff
ALTER TABLE naya.drivers ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES naya.users(id);
CREATE INDEX IF NOT EXISTS drivers_registered_by_idx ON naya.drivers (registered_by) WHERE registered_by IS NOT NULL;

-- Maeneo yaliyopendekezwa na staff yanasubiri ofisi iyaidhinishe (maeneo yote ya zamani = APPROVED).
ALTER TABLE naya.locations ADD COLUMN IF NOT EXISTS review_status varchar(10) NOT NULL DEFAULT 'APPROVED'
  CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE naya.locations ADD COLUMN IF NOT EXISTS review_note varchar(200);
ALTER TABLE naya.locations ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES naya.users(id);
ALTER TABLE naya.locations ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
CREATE INDEX IF NOT EXISTS locations_review_idx ON naya.locations (created_at) WHERE review_status <> 'APPROVED';
