-- 0.16.0 Malipo ya simu: ada ya mwezi (dereva → NAYA) na malipo ya ofa ya moja kwa moja (NAYA → dereva).
-- Inaongeza jedwali na safu tu; NOT NULL mbili zinalegezwa (malipo ya mfumo hayana mfanyakazi). Haifuti data.

CREATE TABLE naya.payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           varchar(20) NOT NULL CHECK (kind IN ('SUBSCRIPTION', 'PROMO_PAYOUT')),
  direction      varchar(3)  NOT NULL CHECK (direction IN ('IN', 'OUT')),
  user_id        uuid NOT NULL REFERENCES naya.users(id),
  amount         integer NOT NULL CHECK (amount > 0),
  network        varchar(20) NOT NULL,
  phone          varchar(20) NOT NULL,
  provider       varchar(30) NOT NULL,
  reference      varchar(40) NOT NULL UNIQUE,      -- yetu (inatumwa kwa kampuni ya malipo)
  provider_ref   varchar(100),                      -- ya kampuni ya malipo / mtandao
  status         varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  failure_reason varchar(300),
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt        smallint NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES naya.users(id),   -- ofisi ikituma upya; NULL = mfumo / dereva mwenyewe
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX payments_user_idx ON naya.payments (user_id, created_at DESC);
CREATE INDEX payments_pending_idx ON naya.payments (created_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX payments_provider_ref_unique ON naya.payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
ALTER TABLE naya.payments ENABLE ROW LEVEL SECURITY;

-- Ada iliyolipwa kwa simu haina "aliyerekodi" (mfumo) — na inaunganishwa na muamala wake
ALTER TABLE naya.subscription_payments ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE naya.subscription_payments ADD COLUMN payment_id uuid REFERENCES naya.payments(id);
CREATE UNIQUE INDEX subscription_payments_payment_unique ON naya.subscription_payments (payment_id) WHERE payment_id IS NOT NULL;

-- Malipo ya ofa yaliyotumwa na mfumo
ALTER TABLE naya.promo_payouts ALTER COLUMN paid_by DROP NOT NULL;
ALTER TABLE naya.promo_payouts ADD COLUMN payment_id uuid REFERENCES naya.payments(id);
CREATE UNIQUE INDEX promo_payouts_payment_unique ON naya.promo_payouts (payment_id) WHERE payment_id IS NOT NULL;

-- Kila safari ya ofa: hali ya malipo yake ya moja kwa moja
--   NULL = ya mkono (kama zamani) · PENDING = inatumwa · PAID = imetumwa · HELD = inasubiri ukaguzi
--   FAILED = imeshindwa (ofisi inaweza kujaribu tena) · REJECTED = ofisi imekataa (haidaiwi)
ALTER TABLE naya.rides ADD COLUMN promo_payout_state varchar(10)
  CHECK (promo_payout_state IN ('PENDING', 'PAID', 'HELD', 'FAILED', 'REJECTED'));
ALTER TABLE naya.rides ADD COLUMN promo_payout_note varchar(200);
ALTER TABLE naya.rides ADD COLUMN promo_payment_id uuid REFERENCES naya.payments(id);
CREATE INDEX rides_promo_payout_idx ON naya.rides (promo_payout_state) WHERE promo_payout_state IN ('HELD', 'FAILED', 'PENDING');

INSERT INTO naya.settings (key, value) VALUES ('auto_payout', '{"enabled": true, "dailyLimit": 10000}')
ON CONFLICT (key) DO NOTHING;
