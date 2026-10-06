-- Phase 8: ada ya mwezi ya madereva, na usalama wa safari (PIN, kushiriki safari, dharura).
-- Tables mpya + safu mpya tu. Hakuna kinachofutwa.

-- ---------------------------------------------------------------- Mipangilio ya ofisi
CREATE TABLE naya.settings (
  key        varchar(50) PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES naya.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO naya.settings (key, value) VALUES (
  'subscription',
  '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ada yako ofisini kwa NAYA. Ofisi itarekodi malipo yako na utaweza kwenda online mara moja."}'
) ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- Ada ya mwezi
ALTER TABLE naya.drivers
  ADD COLUMN paid_until        timestamptz,  -- dereva anaruhusiwa kupokea safari mpaka hapa (+ siku za kuvumiliwa)
  ADD COLUMN reminder_sent_for timestamptz,  -- ukumbusho wa "ada inakaribia kuisha" umetumwa kwa paid_until hii
  ADD COLUMN expiry_sent_for   timestamptz;  -- arifa ya "ada imeisha" imetumwa kwa paid_until hii

-- Madereva waliokwisha thibitishwa kabla ya Phase 8 wanapewa siku 30 kuanzia sasa — hakuna anayezuiwa ghafla.
UPDATE naya.drivers SET paid_until = now() + interval '30 days'
 WHERE status IN ('APPROVED', 'SUSPENDED') AND paid_until IS NULL;

CREATE TABLE naya.subscription_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES naya.drivers(user_id),
  months              smallint NOT NULL CHECK (months BETWEEN 1 AND 12),
  amount              integer NOT NULL CHECK (amount >= 0),           -- TZS
  method              varchar(12) NOT NULL CHECK (method IN ('CASH', 'MPESA', 'AIRTEL', 'TIGO', 'HALOPESA', 'BANK')),
  reference           varchar(40),                                    -- namba ya muamala (si lazima kwa taslimu)
  note                varchar(300),
  previous_paid_until timestamptz,                                    -- kwa kubatilisha malipo yaliyokosewa
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  recorded_by         uuid NOT NULL REFERENCES naya.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by           uuid REFERENCES naya.users(id),
  void_reason         varchar(300)
);
CREATE INDEX subscription_payments_driver_idx ON naya.subscription_payments (driver_id, created_at DESC);
CREATE INDEX subscription_payments_created_idx ON naya.subscription_payments (created_at) WHERE voided_at IS NULL;
-- Namba moja ya muamala (mf. ya M-Pesa) haiwezi kurekodiwa mara mbili.
CREATE UNIQUE INDEX subscription_payments_reference_unique ON naya.subscription_payments (method, upper(reference))
  WHERE reference IS NOT NULL AND voided_at IS NULL;

-- ---------------------------------------------------------------- Usalama wa safari
ALTER TABLE naya.rides
  ADD COLUMN start_pin        char(4),                      -- abiria anampa dereva kabla ya kuanza safari
  ADD COLUMN pin_attempts     smallint NOT NULL DEFAULT 0,
  ADD COLUMN share_token_hash bytea,                        -- SHA-256 ya link ya kushiriki safari (link yenyewe haihifadhiwi)
  ADD COLUMN shared_at        timestamptz;
CREATE UNIQUE INDEX rides_share_token_unique ON naya.rides (share_token_hash) WHERE share_token_hash IS NOT NULL;

CREATE TABLE naya.sos_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES naya.users(id),
  ride_id         uuid NOT NULL REFERENCES naya.rides(id),
  role            varchar(10) NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
  lat             numeric(9, 6),
  lng             numeric(9, 6),
  status          varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES naya.users(id),
  resolution_note varchar(500)
);
CREATE INDEX sos_alerts_status_idx ON naya.sos_alerts (status, created_at DESC);
-- Dharura moja tu iliyo wazi kwa mtu mmoja kwenye safari moja (kubonyeza mara nyingi hakuleti nakala).
CREATE UNIQUE INDEX sos_alerts_one_open_per_ride_user ON naya.sos_alerts (ride_id, user_id) WHERE status = 'OPEN';

ALTER TABLE naya.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.sos_alerts ENABLE ROW LEVEL SECURITY;
