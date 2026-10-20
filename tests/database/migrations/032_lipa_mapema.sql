-- 0.22.1 Abiria analipa kwa simu mapema (dereva akishakubali, safari ikiendelea) — si lazima afike kwanza.
--   Pesa inashikiliwa mpaka safari ikamilike, kisha inaingia kwenye wallet ya dereva aliyemaliza safari.
--   Safari ikighairiwa baada ya kulipa → fare_refund = 'NEEDED' (ofisi inamrudishia abiria) → 'DONE'.
-- Inaongeza safu tu; haifuti wala kubadilisha data iliyopo.
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_refund varchar(8) CHECK (fare_refund IN ('NEEDED', 'DONE'));
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_refund_at timestamptz;
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_refund_by uuid REFERENCES naya.users(id);
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_refund_note varchar(200);
CREATE INDEX IF NOT EXISTS rides_fare_refund_idx ON naya.rides (fare_refund) WHERE fare_refund = 'NEEDED';
