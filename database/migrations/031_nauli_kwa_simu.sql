-- 0.22.0 Abiria kulipa nauli kwa simu (akifika): pesa inaingia kwenye wallet ya dereva.
--   fare_settlement: NULL = bado (au cash ya zamani) · CASH = dereva amepokea taslimu · MOBILE = imelipwa kwa simu
--                    · DEBT = abiria hakulipa → deni (anazuiwa kuagiza mpaka alipe).
-- Inaongeza safu / index tu na kupanua CHECK moja; haifuti wala kubadilisha data iliyopo.

ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_settlement varchar(8) CHECK (fare_settlement IN ('CASH', 'MOBILE', 'DEBT'));
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_settled_at timestamptz;
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS fare_payment_id uuid REFERENCES naya.payments(id);
-- Deni likilipwa / likifutwa na ofisi
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS debt_cleared_at timestamptz;
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS debt_cleared_how varchar(10) CHECK (debt_cleared_how IN ('MOBILE', 'CASH', 'FORGIVEN'));
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS debt_cleared_by uuid REFERENCES naya.users(id);
ALTER TABLE naya.rides ADD COLUMN IF NOT EXISTS debt_note varchar(200);
CREATE INDEX IF NOT EXISTS rides_open_debt_idx ON naya.rides (passenger_id) WHERE fare_settlement = 'DEBT' AND debt_cleared_at IS NULL;

-- Muamala wa abiria kulipa nauli (au deni) kwa simu
ALTER TABLE naya.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE naya.payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('SUBSCRIPTION', 'PROMO_PAYOUT', 'WALLET_WITHDRAWAL', 'RIDE_FARE'));

-- Malipo moja ya deni yanaweza kulipa safari kadhaa (madereva tofauti) → mistari kadhaa ya RIDE_EARNING yenye payment_id ileile.
-- Kinga ya kulipa mara mbili kwa RIDE_EARNING ni (kind, ride_id) — index ya wallet_entries_ride_earning_unique (030).
DROP INDEX IF EXISTS naya.wallet_entries_payment_unique;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_entries_payment_unique2 ON naya.wallet_entries (kind, payment_id)
  WHERE payment_id IS NOT NULL AND kind <> 'RIDE_EARNING';
