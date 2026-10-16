-- 0.21.0 Wallet ya dereva: kila dereva ana salio lake ndani ya NAYA (mapato ambayo NAYA inamdai), anatoa kwenda
-- namba yake ya malipo iliyothibitishwa kwa PIN yake mwenyewe, au analipa ada ya mwezi kwa salio.
-- Inaongeza majedwali / safu tu na kupanua CHECK mbili; haifuti wala kubadilisha data iliyopo.

CREATE TABLE IF NOT EXISTS naya.wallets (
  driver_id            uuid PRIMARY KEY REFERENCES naya.drivers(user_id) ON DELETE CASCADE,
  -- Salio linasasishwa PAMOJA na kila mstari wa ledger (ndani ya transaction moja, safu ikiwa imefungwa).
  -- Database yenyewe inakataa salio hasi: hakuna njia ya kutoa zaidi ya alichonacho dereva.
  balance              integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status               varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  pin_hash             varchar(100),                 -- bcrypt; NULL = dereva bado hajaweka PIN (kutoa kumefungwa)
  pin_set_at           timestamptz,
  pin_failed           smallint NOT NULL DEFAULT 0,  -- makosa mfululizo tangu PIN sahihi ya mwisho
  pin_locked_until     timestamptz,                  -- makosa 5 → dakika 30
  pin_blocked          boolean NOT NULL DEFAULT false, -- makosa 10 → mpaka ofisi ifungue
  pin_reset_requested_at timestamptz,                -- "Nimesahau PIN"
  pin_reset_allowed_at timestamptz,                  -- ofisi imeruhusu PIN mpya
  pin_reset_allowed_by uuid REFERENCES naya.users(id),
  hold_until           timestamptz,                  -- kutoa kunasubiri (saa 24 baada ya kubadilisha namba au PIN)
  hold_reason          varchar(120),
  suspended_reason     varchar(200),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE naya.wallets ENABLE ROW LEVEL SECURITY;

-- Ledger: kila shilingi inayoingia (+) au kutoka (−) kwenye wallet, na salio baada ya mstari huo.
CREATE TABLE IF NOT EXISTS naya.wallet_entries (
  id             bigserial PRIMARY KEY,
  driver_id      uuid NOT NULL REFERENCES naya.wallets(driver_id) ON DELETE CASCADE,
  amount         integer NOT NULL CHECK (amount <> 0),
  balance_after  integer NOT NULL CHECK (balance_after >= 0),
  kind           varchar(24) NOT NULL CHECK (kind IN ('PROMO_EARNING', 'RIDE_EARNING', 'WITHDRAWAL', 'WITHDRAWAL_REVERSAL', 'SUBSCRIPTION', 'ADJUSTMENT')),
  ride_id        uuid REFERENCES naya.rides(id),
  payment_id     uuid REFERENCES naya.payments(id),
  note           varchar(300),
  created_by     uuid REFERENCES naya.users(id),     -- ofisi (marekebisho); NULL = mfumo / dereva mwenyewe
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_entries_driver_idx ON naya.wallet_entries (driver_id, id DESC);
-- Kinga ya kurudia: safari moja inaingiza mapato mara moja tu; muamala mmoja wa kutoa unakatwa / unarudishwa mara moja tu.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_entries_ride_earning_unique ON naya.wallet_entries (kind, ride_id) WHERE ride_id IS NOT NULL AND kind IN ('PROMO_EARNING', 'RIDE_EARNING');
CREATE UNIQUE INDEX IF NOT EXISTS wallet_entries_payment_unique ON naya.wallet_entries (kind, payment_id) WHERE payment_id IS NOT NULL;
ALTER TABLE naya.wallet_entries ENABLE ROW LEVEL SECURITY;

-- Muamala wa kutoa pesa kutoka wallet (kampuni ya malipo → namba ya dereva)
ALTER TABLE naya.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE naya.payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('SUBSCRIPTION', 'PROMO_PAYOUT', 'WALLET_WITHDRAWAL'));

-- Ada iliyolipwa kwa salio la wallet
ALTER TABLE naya.subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_method_check;
ALTER TABLE naya.subscription_payments ADD CONSTRAINT subscription_payments_method_check
  CHECK (method IN ('CASH', 'MPESA', 'AIRTEL', 'TIGO', 'HALOPESA', 'BANK', 'CONTROL', 'WALLET'));

-- Wallet kwa kila dereva aliyekwisha thibitishwa (salio 0, PIN bado haijawekwa)
INSERT INTO naya.wallets (driver_id)
SELECT user_id FROM naya.drivers WHERE status IN ('APPROVED', 'SUSPENDED')
ON CONFLICT (driver_id) DO NOTHING;
