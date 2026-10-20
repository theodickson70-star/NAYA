-- 0.24.0 Ofisi kumrudishia mteja pesa (malalamiko, safari mbovu, kukatwa mara mbili, fidia):
--   kwenye Salio la NAYA (papo hapo) au kwenye namba yake ya simu (Abliner → kutuma; NAYA inabeba ada ya kutuma).
-- Inapanua CHECK mbili tu; haifuti wala kubadilisha data iliyopo.
ALTER TABLE naya.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE naya.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind IN ('SUBSCRIPTION', 'PROMO_PAYOUT', 'WALLET_WITHDRAWAL', 'RIDE_FARE', 'CUSTOMER_TOPUP', 'CUSTOMER_REFUND'));

ALTER TABLE naya.customer_wallet_entries DROP CONSTRAINT IF EXISTS customer_wallet_entries_kind_check;
ALTER TABLE naya.customer_wallet_entries ADD CONSTRAINT customer_wallet_entries_kind_check
  CHECK (kind IN ('TOPUP', 'RIDE_PAYMENT', 'RIDE_REFUND', 'DEBT_PAYMENT', 'CASHOUT', 'ADJUSTMENT', 'REFUND'));
CREATE INDEX IF NOT EXISTS customer_wallet_entries_ride_idx ON naya.customer_wallet_entries (ride_id) WHERE ride_id IS NOT NULL;
