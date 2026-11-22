-- Phase 3: madereva, chombo chao, nyaraka, na kumbukumbu ya hatua za ofisi (audit log).
-- Hakuna kinachofutwa: migration hii inaongeza tables mpya tu.

CREATE TYPE naya.vehicle_type AS ENUM ('BODABODA', 'BAJAJI');

-- INCOMPLETE: amejisajili, bado hajatuma | PENDING: inasubiri ofisi | APPROVED | REJECTED: arekebishe | SUSPENDED
CREATE TYPE naya.driver_status AS ENUM ('INCOMPLETE', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

CREATE TYPE naya.document_type AS ENUM ('PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO', 'INSURANCE');
CREATE TYPE naya.document_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE naya.drivers (
  user_id            uuid PRIMARY KEY REFERENCES naya.users(id) ON DELETE CASCADE,
  status             naya.driver_status NOT NULL DEFAULT 'INCOMPLETE',
  vehicle_type       naya.vehicle_type,
  plate_number       varchar(16) UNIQUE,
  vehicle_make       varchar(60),
  vehicle_model      varchar(60),
  vehicle_color      varchar(40),
  license_number     varchar(30),
  national_id_number varchar(20),
  rejection_reason   text,
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid REFERENCES naya.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_status_idx ON naya.drivers (status, submitted_at);

-- Faili zenyewe (bytes). Zimetengwa na maelezo ya nyaraka ili orodha zisisome picha bila sababu,
-- na ili baadaye tuweze kuhamia Supabase Storage (storage = 'supabase') bila kubadilisha API.
CREATE TABLE naya.document_files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content    bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE naya.driver_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES naya.drivers(user_id) ON DELETE CASCADE,
  doc_type    naya.document_type NOT NULL,
  status      naya.document_status NOT NULL DEFAULT 'PENDING',
  mime_type   varchar(40) NOT NULL,
  size_bytes  integer NOT NULL,
  sha256      char(64) NOT NULL,
  storage     varchar(20) NOT NULL DEFAULT 'db',
  storage_key text NOT NULL,
  review_note text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (driver_id, doc_type)
);

-- Kila hatua ya ofisi (kuthibitisha, kukataa, kusimamisha...) inaandikwa hapa: nani, nini, lini.
CREATE TABLE naya.audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES naya.users(id),
  action      varchar(60) NOT NULL,
  target_type varchar(30) NOT NULL,
  target_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON naya.audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON naya.audit_logs (created_at DESC);

ALTER TABLE naya.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.audit_logs ENABLE ROW LEVEL SECURITY;
