-- Ofa za wateja (punguzo la bei). NAYA inalipa sehemu iliyopunguzwa kwa dereva kupitia namba yake ya pesa ya simu.
-- Tables na columns mpya tu — hakuna data inayofutwa.

CREATE TABLE naya.promotions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(80) NOT NULL,                       -- ndani ya ofisi, mf. "Nusu bei kwa wote"
  title              varchar(80) NOT NULL,                       -- anachoona mteja, mf. "Nusu bei!"
  description        varchar(300),                               -- maelezo kwa mteja
  audience           varchar(20) NOT NULL CHECK (audience IN ('ALL', 'NEW_CUSTOMERS')),
  discount_percent   smallint NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  max_discount       integer CHECK (max_discount > 0),           -- punguzo la juu kwa safari moja (TSh)
  min_fare           integer CHECK (min_fare >= 0),              -- nauli ya chini ili ofa itumike
  max_fare           integer CHECK (max_fare > 0),               -- nauli ya juu ili ofa itumike
  vehicle_types      naya.vehicle_type[],                        -- NULL = vyombo vyote
  per_customer_limit integer CHECK (per_customer_limit > 0),     -- safari za ofa kwa mteja mmoja (kipindi chote)
  per_driver_limit   integer CHECK (per_driver_limit > 0),       -- safari za ofa kwa dereva mmoja kwa kipindi
  per_driver_period  varchar(10) NOT NULL DEFAULT 'WEEK' CHECK (per_driver_period IN ('DAY', 'WEEK', 'TOTAL')),
  budget             integer CHECK (budget > 0),                 -- jumla ya pesa ambayo NAYA iko tayari kulipa (TSh)
  priority           smallint NOT NULL DEFAULT 0,                -- ofa mbili zikilingana, kubwa zaidi inashinda
  status             varchar(10) NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  created_by         uuid REFERENCES naya.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (max_fare IS NULL OR min_fare IS NULL OR max_fare >= min_fare)
);
ALTER TABLE naya.promotions ENABLE ROW LEVEL SECURITY;

-- Safari: ofa iliyotumika na punguzo lake. Abiria analipa (fare - promo_discount); NAYA inamdai dereva promo_discount.
ALTER TABLE naya.rides ADD COLUMN promotion_id uuid REFERENCES naya.promotions(id);
ALTER TABLE naya.rides ADD COLUMN promo_discount integer NOT NULL DEFAULT 0 CHECK (promo_discount >= 0);
ALTER TABLE naya.rides ADD COLUMN promo_title varchar(80);
ALTER TABLE naya.rides ADD CONSTRAINT rides_promo_le_fare CHECK (promo_discount <= fare);
CREATE INDEX rides_promotion_idx ON naya.rides (promotion_id, status) WHERE promotion_id IS NOT NULL;

-- Namba za dereva za kupokea malipo ya NAYA (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa ...)
CREATE TABLE naya.driver_payout_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES naya.drivers(user_id) ON DELETE CASCADE,
  network      varchar(20) NOT NULL CHECK (network IN ('MPESA', 'MIXX', 'AIRTEL', 'HALOPESA', 'TPESA', 'BANK')),
  phone        varchar(20) NOT NULL,
  account_name varchar(80) NOT NULL,
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, network, phone)
);
CREATE UNIQUE INDEX driver_payout_one_primary ON naya.driver_payout_accounts (driver_id) WHERE is_primary;
ALTER TABLE naya.driver_payout_accounts ENABLE ROW LEVEL SECURITY;

-- Malipo halisi ambayo ofisi imeshatuma kwa dereva (ofisi inaandika BAADA ya kutuma pesa; kumbukumbu ya muamala inahitajika).
CREATE TABLE naya.promo_payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES naya.drivers(user_id),
  amount      integer NOT NULL CHECK (amount > 0),
  network     varchar(20) NOT NULL,
  phone       varchar(20) NOT NULL,
  account_name varchar(80),
  reference   varchar(60) NOT NULL,                              -- namba ya muamala (mf. ya M-Pesa)
  note        varchar(300),
  paid_by     uuid NOT NULL REFERENCES naya.users(id),
  paid_at     timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   uuid REFERENCES naya.users(id),
  void_reason varchar(300)
);
CREATE INDEX promo_payouts_driver_idx ON naya.promo_payouts (driver_id, paid_at DESC);
CREATE UNIQUE INDEX promo_payouts_reference_unique ON naya.promo_payouts (lower(reference)) WHERE voided_at IS NULL;
ALTER TABLE naya.promo_payouts ENABLE ROW LEVEL SECURITY;

-- Ofa mbili za sasa — zimeandaliwa lakini ZIMESIMAMISHWA: ofisi inazikagua na kubonyeza "Washa".
INSERT INTO naya.promotions (name, title, description, audience, discount_percent, max_discount, per_customer_limit, per_driver_limit, per_driver_period, priority)
VALUES
  ('Mteja mpya: safari 2 nusu bei', 'Karibu NAYA: nusu bei!',
   'Safari zako 2 za kwanza ni nusu bei (punguzo hadi TSh 1,500). NAYA inamlipa dereva kilichobaki.',
   'NEW_CUSTOMERS', 50, 1500, 2, NULL, 'WEEK', 10),
  ('Nusu bei kwa wateja wote', 'Ofa: nusu bei!',
   'Lipa nusu ya nauli — NAYA inamlipa dereva kilichobaki.',
   'ALL', 50, NULL, NULL, 3, 'WEEK', 0);
