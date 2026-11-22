-- Phase 13: ukurasa wa kupakua APK — tunahesabu idadi ya waliobonyeza "Pakua" (aina ya simu na muda tu, hakuna taarifa binafsi).
-- Table mpya tu. Hakuna kinachofutwa.
CREATE TABLE naya.app_downloads (
  id         bigserial PRIMARY KEY,
  platform   varchar(10) NOT NULL CHECK (platform IN ('android', 'ios', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_downloads_created_idx ON naya.app_downloads (created_at DESC);
ALTER TABLE naya.app_downloads ENABLE ROW LEVEL SECURITY;
