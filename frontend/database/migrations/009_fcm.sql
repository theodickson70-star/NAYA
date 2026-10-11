-- Phase 10: app ya Android (APK). Kila simu yenye app ya NAYA inasajili "token" ya Firebase Cloud Messaging
-- ili server iweze kupiga kengele ya ombi la safari hata app ikiwa imefungwa. Table mpya tu — hakuna kinachofutwa.
CREATE TABLE naya.fcm_tokens (
  token           text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  platform        varchar(20) NOT NULL DEFAULT 'android',
  app_version     varchar(30),
  failures        integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fcm_tokens_user_idx ON naya.fcm_tokens (user_id);

ALTER TABLE naya.fcm_tokens ENABLE ROW LEVEL SECURITY;
