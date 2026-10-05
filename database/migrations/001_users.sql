-- NAYA 001: watumiaji na roles.
-- Majedwali yote ya NAYA yako kwenye schema "naya" (si "public"): hayagongani na majedwali mengine
-- ya database hii, na Data API ya Supabase (anon key) haiyaoni.

CREATE TYPE naya.user_role AS ENUM ('CUSTOMER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE naya.user_status AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE naya.users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          VARCHAR(15)  NOT NULL UNIQUE,          -- 2557XXXXXXXX (index kupitia UNIQUE)
  full_name      VARCHAR(120) NOT NULL,
  role           naya.user_role   NOT NULL DEFAULT 'CUSTOMER',
  status         naya.user_status NOT NULL DEFAULT 'ACTIVE',
  password_hash  TEXT NOT NULL,                         -- bcrypt; kamwe password yenyewe
  token_version  INTEGER NOT NULL DEFAULT 0,            -- ikiongezeka, tokens zote za zamani zinakufa (logout)
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON naya.users (role);
CREATE INDEX idx_users_created_at ON naya.users (created_at);

-- Ulinzi wa ziada: hata schema ikifunguliwa kwa Data API siku moja, safu hazisomeki bila policy.
ALTER TABLE naya.users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA naya FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA naya FROM authenticated';
  END IF;
END
$$;
