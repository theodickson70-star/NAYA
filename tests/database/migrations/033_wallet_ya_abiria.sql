-- 0.23.0 Wallet ya abiria (NAYA Salio): abiria anaweka pesa kwa simu (M-Pesa, Mixx, Airtel, HaloPesa) na kulipia safari / deni.
--   Salio linatumika ndani ya NAYA tu; kikomo (chaguo-msingi TSh 15,000) kiko kwenye mipangilio. Abiria akiomba, ofisi
--   inamrudishia salio lililobaki kwa simu (kwa mkono) na kuliandika hapa. Safari iliyolipwa kwa salio ikighairiwa → pesa inarudi kwenye salio papo hapo.
-- Inaongeza majedwali / safu tu na kupanua CHECK mbili; haifuti wala kubadilisha data iliyopo.

CREATE TABLE IF NOT EXISTS naya.customer_wallets (
  user_id              uuid PRIMARY KEY REFERENCES naya.users(id) ON DELETE RESTRICT,   -- pesa ya mteja: kamwe isifutwe kimya
  balance              integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status               varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  cashout_requested_at timestamptz,               -- abiria ameomba kurudishiwa salio
  cashout_phone        varchar(15),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE naya.customer_wallets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS naya.customer_wallet_entries (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES naya.customer_wallets(user_id) ON DELETE RESTRICT,
  amount         integer NOT NULL CHECK (amount <> 0),
  balance_after  integer NOT NULL CHECK (balance_after >= 0),
  kind           varchar(16) NOT NULL CHECK (kind IN ('TOPUP', 'RIDE_PAYMENT', 'RIDE_REFUND', 'DEBT_PAYMENT', 'CASHOUT', 'ADJUSTMENT')),
  ride_id        uuid REFERENCES naya.rides(id),
  payment_id     uuid REFERENCES naya.payments(id),
  note           varchar(300),
  created_by     uuid REFERENCES naya.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_wallet_entries_user_idx ON naya.customer_wallet_entries (user_id, id DESC);
-- Kinga ya mara mbili: kuweka pesa mara moja kwa kila muamala; kulipa / kurudishiwa safari mara moja kwa kila safari
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_topup_unique ON naya.customer_wallet_entries (payment_id) WHERE kind = 'TOPUP';
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_ride_unique ON naya.customer_wallet_entries (kind, ride_id) WHERE kind IN ('RIDE_PAYMENT', 'RIDE_REFUND', 'DEBT_PAYMENT');
ALTER TABLE naya.customer_wallet_entries ENABLE ROW LEVEL SECURITY;

-- Muamala wa abiria kuweka pesa kwenye salio
ALTER TABLE naya.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE naya.payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('SUBSCRIPTION', 'PROMO_PAYOUT', 'WALLET_WITHDRAWAL', 'RIDE_FARE', 'CUSTOMER_TOPUP'));

-- Safari iliyolipwa kwa salio (WALLET); deni lililolipwa kwa salio
ALTER TABLE naya.rides DROP CONSTRAINT IF EXISTS rides_fare_settlement_check;
ALTER TABLE naya.rides ADD CONSTRAINT rides_fare_settlement_check CHECK (fare_settlement IN ('CASH', 'MOBILE', 'DEBT', 'WALLET'));
ALTER TABLE naya.rides DROP CONSTRAINT IF EXISTS rides_debt_cleared_how_check;
ALTER TABLE naya.rides ADD CONSTRAINT rides_debt_cleared_how_check CHECK (debt_cleared_how IN ('MOBILE', 'CASH', 'FORGIVEN', 'WALLET'));
