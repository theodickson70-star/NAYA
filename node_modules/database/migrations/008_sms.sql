-- Phase 9: SMS (Beem) — kuthibitisha namba ya simu, kurejesha password, na kumbukumbu ya SMS.
-- Tables mpya + safu moja mpya. Hakuna kinachofutwa.

-- Namba ya simu imethibitishwa kwa SMS lini (null = bado).
ALTER TABLE naya.users ADD COLUMN phone_verified_at timestamptz;
-- Watumiaji waliojisajili kabla ya Phase 9 hawalazimishwi kuthibitisha upya (wangezuiwa ghafla).
-- Namba zao zinathibitishwa wenyewe mara ya kwanza wakirejesha password kwa SMS.
UPDATE naya.users SET phone_verified_at = created_at WHERE phone_verified_at IS NULL;

-- Namba za siri za mara moja (OTP). Code yenyewe haihifadhiwi — HMAC yake tu.
CREATE TABLE naya.otp_codes (
  id          bigserial PRIMARY KEY,
  phone       varchar(15) NOT NULL,
  purpose     varchar(20) NOT NULL CHECK (purpose IN ('VERIFY_PHONE', 'RESET_PASSWORD')),
  code_hash   bytea NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_lookup_idx ON naya.otp_codes (phone, purpose, created_at DESC);

-- Kila SMS iliyotumwa (au kushindwa): aina tu, KAMWE si maandishi yake (OTP ni siri).
CREATE TABLE naya.sms_log (
  id          bigserial PRIMARY KEY,
  phone       varchar(15) NOT NULL,
  kind        varchar(40) NOT NULL,
  status      varchar(10) NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  request_id  varchar(80),
  error       varchar(200),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_log_created_idx ON naya.sms_log (created_at DESC);

ALTER TABLE naya.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.sms_log ENABLE ROW LEVEL SECURITY;
