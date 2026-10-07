-- Phase 4: maeneo ya huduma na kanuni za nauli (TZS). Tables mpya tu — hakuna kinachofutwa.
-- Hakuna data ya kubuni: maeneo na bei zinawekwa na ofisi kupitia /admin/.

CREATE TABLE naya.locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(80) NOT NULL,
  area        varchar(80),
  category    varchar(20) NOT NULL DEFAULT 'OTHER'
              CHECK (category IN ('STAND', 'MARKET', 'HOSPITAL', 'SCHOOL', 'OFFICE', 'WORSHIP', 'NEIGHBORHOOD', 'OTHER')),
  lat         numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES naya.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Jina moja haliwezi kurudiwa kati ya maeneo yanayotumika (bila kujali herufi kubwa/ndogo).
CREATE UNIQUE INDEX locations_active_name_idx ON naya.locations (lower(name)) WHERE is_active;

-- Kanuni moja kwa kila aina ya chombo.
-- nauli = max(minimum_fare, base_fare + per_km × umbali_wa_barabara), ikizungushwa juu kwa rounding_step.
-- umbali_wa_barabara = umbali wa moja kwa moja × road_factor (barabara hazinyooki).
CREATE TABLE naya.fare_rules (
  vehicle_type   naya.vehicle_type PRIMARY KEY,
  base_fare      integer NOT NULL CHECK (base_fare >= 0),
  per_km         integer NOT NULL CHECK (per_km >= 0),
  minimum_fare   integer NOT NULL CHECK (minimum_fare >= 0),
  rounding_step  integer NOT NULL DEFAULT 100 CHECK (rounding_step IN (50, 100, 200, 500, 1000)),
  road_factor    numeric(3, 2) NOT NULL DEFAULT 1.30 CHECK (road_factor BETWEEN 1.00 AND 2.00),
  is_active      boolean NOT NULL DEFAULT true,
  updated_by     uuid REFERENCES naya.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE naya.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.fare_rules ENABLE ROW LEVEL SECURITY;
