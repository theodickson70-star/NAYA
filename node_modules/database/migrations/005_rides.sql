-- Phase 5+6: safari kamili. Tables mpya + safu mpya kwa madereva. Hakuna kinachofutwa.

-- Dereva online/offline na mahali alipo mara ya mwisho (kutoka GPS ya app au eneo alilochagua).
ALTER TABLE naya.drivers
  ADD COLUMN is_online    boolean NOT NULL DEFAULT false,
  ADD COLUMN last_lat     numeric(9, 6),
  ADD COLUMN last_lng     numeric(9, 6),
  ADD COLUMN last_seen_at timestamptz;
CREATE INDEX drivers_online_idx ON naya.drivers (is_online, last_seen_at) WHERE is_online;

-- SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED
--          ↘ NO_DRIVER (hakuna dereva)      ↘ CANCELLED (abiria / ofisi)
CREATE TYPE naya.ride_status AS ENUM ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVER');

CREATE TABLE naya.rides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        uuid NOT NULL REFERENCES naya.users(id),
  driver_id           uuid REFERENCES naya.drivers(user_id),
  vehicle_type        naya.vehicle_type NOT NULL,
  status              naya.ride_status NOT NULL DEFAULT 'SEARCHING',
  pickup_location_id  uuid REFERENCES naya.locations(id),
  pickup_name         varchar(80) NOT NULL,
  pickup_lat          numeric(9, 6) NOT NULL,
  pickup_lng          numeric(9, 6) NOT NULL,
  dest_location_id    uuid NOT NULL REFERENCES naya.locations(id),
  dest_name           varchar(80) NOT NULL,
  dest_lat            numeric(9, 6) NOT NULL,
  dest_lng            numeric(9, 6) NOT NULL,
  distance_km         numeric(6, 1) NOT NULL,
  fare                integer NOT NULL CHECK (fare >= 0),            -- TZS, imehesabiwa na server
  payment_method      varchar(20) NOT NULL DEFAULT 'CASH',
  cancelled_by        varchar(20) CHECK (cancelled_by IN ('PASSENGER', 'DRIVER', 'ADMIN', 'SYSTEM')),
  cancel_reason       text,
  rating_for_driver   smallint CHECK (rating_for_driver BETWEEN 1 AND 5),
  comment_for_driver  varchar(300),
  rating_for_passenger smallint CHECK (rating_for_passenger BETWEEN 1 AND 5),
  passenger_closed    boolean NOT NULL DEFAULT false,  -- abiria ameshafunga skrini ya safari hii
  driver_closed       boolean NOT NULL DEFAULT false,  -- dereva ameshafunga skrini ya safari hii
  requested_at        timestamptz NOT NULL DEFAULT now(),
  search_started_at   timestamptz NOT NULL DEFAULT now(), -- inaanza upya dereva akighairi (kutafuta mwingine)
  accepted_at         timestamptz,
  arrived_at          timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rides_passenger_idx ON naya.rides (passenger_id, requested_at DESC);
CREATE INDEX rides_driver_idx ON naya.rides (driver_id, requested_at DESC);
CREATE INDEX rides_status_idx ON naya.rides (status, requested_at);
-- Kinga ya database: abiria ana safari moja tu inayoendelea; dereva ana safari moja tu inayoendelea.
CREATE UNIQUE INDEX rides_one_active_per_passenger ON naya.rides (passenger_id)
  WHERE status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS');
CREATE UNIQUE INDEX rides_one_active_per_driver ON naya.rides (driver_id)
  WHERE status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS');

-- Ombi la safari kwa dereva mmoja (sekunde chache za kukubali/kukataa).
CREATE TABLE naya.ride_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      uuid NOT NULL REFERENCES naya.rides(id) ON DELETE CASCADE,
  driver_id    uuid NOT NULL REFERENCES naya.drivers(user_id),
  status       varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  distance_km  numeric(6, 1),                   -- umbali wa dereva hadi kwa abiria wakati wa ombi
  offered_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (ride_id, driver_id)
);
CREATE INDEX ride_offers_driver_pending_idx ON naya.ride_offers (driver_id) WHERE status = 'PENDING';
-- Dereva ana ombi moja tu linalosubiri kwa wakati mmoja.
CREATE UNIQUE INDEX ride_offers_one_pending_per_driver ON naya.ride_offers (driver_id) WHERE status = 'PENDING';

-- Kila badiliko la hali ya safari: nani, lini, kutoka nini kwenda nini.
CREATE TABLE naya.ride_status_history (
  id          bigserial PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES naya.rides(id) ON DELETE CASCADE,
  from_status naya.ride_status,
  to_status   naya.ride_status NOT NULL,
  actor_id    uuid REFERENCES naya.users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_status_history_ride_idx ON naya.ride_status_history (ride_id, id);

ALTER TABLE naya.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.ride_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.ride_status_history ENABLE ROW LEVEL SECURITY;
