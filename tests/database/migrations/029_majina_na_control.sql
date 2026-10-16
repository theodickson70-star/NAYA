-- 0.20.0 Jina la mwenye namba (Abliner Name Lookup) na Control Numbers (BillPay) kwa ada ya mwezi.
-- Inaongeza majedwali / safu tu na kupanua CHECK moja; haifuti wala kubadilisha data iliyopo.

-- Majina yaliyothibitishwa na mtandao (cache — ili tusiulize Abliner kila mara kwa namba ileile)
CREATE TABLE IF NOT EXISTS naya.phone_names (
  phone       varchar(20) PRIMARY KEY,           -- 2557XXXXXXXX
  found       boolean NOT NULL,
  name        varchar(120),
  network     varchar(20),
  checked_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE naya.phone_names ENABLE ROW LEVEL SECURITY;

-- Nani ameuliza jina la namba gani (kikomo cha kila siku — mtu asitumie NAYA kutafuta majina ya watu)
CREATE TABLE IF NOT EXISTS naya.name_lookups (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  phone       varchar(20) NOT NULL,
  purpose     varchar(20) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS name_lookups_user_idx ON naya.name_lookups (user_id, created_at DESC);
ALTER TABLE naya.name_lookups ENABLE ROW LEVEL SECURITY;

-- Namba za malipo za dereva: jina kama lilivyothibitishwa na mtandao; tahadhari jina likibadilika (laini imehamishwa)
ALTER TABLE naya.driver_payout_accounts ADD COLUMN IF NOT EXISTS verified_name varchar(120);
ALTER TABLE naya.driver_payout_accounts ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE naya.driver_payout_accounts ADD COLUMN IF NOT EXISTS name_changed_to varchar(120);
ALTER TABLE naya.driver_payout_accounts ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;

-- Ada iliyolipwa kwa control number (BillPay) — njia mpya ya malipo kwenye kumbukumbu za ada
ALTER TABLE naya.subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_method_check;
ALTER TABLE naya.subscription_payments ADD CONSTRAINT subscription_payments_method_check
  CHECK (method IN ('CASH', 'MPESA', 'AIRTEL', 'TIGO', 'HALOPESA', 'BANK', 'CONTROL'));
