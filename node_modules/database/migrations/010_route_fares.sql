-- Bei maalum kati ya maeneo mawili (mf. "Stendi Kuu ↔ Soko Kuu: bodaboda 1,000"). Table mpya tu — hakuna kinachofutwa.
-- Bei ni ile ile kwenda na kurudi: kila jozi inahifadhiwa mara moja (location_a < location_b).
-- Safari isiyo na bei maalum inaendelea kutumia kanuni ya km (naya.fare_rules).
CREATE TABLE naya.route_fares (
  location_a   uuid NOT NULL REFERENCES naya.locations(id) ON DELETE CASCADE,
  location_b   uuid NOT NULL REFERENCES naya.locations(id) ON DELETE CASCADE,
  vehicle_type naya.vehicle_type NOT NULL,
  fare         integer NOT NULL CHECK (fare > 0 AND fare <= 1000000),
  updated_by   uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_a, location_b, vehicle_type),
  CHECK (location_a < location_b)
);
CREATE INDEX route_fares_b_idx ON naya.route_fares (location_b);

ALTER TABLE naya.route_fares ENABLE ROW LEVEL SECURITY;
