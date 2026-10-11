-- Phase 11.2: Masharti ya huduma na sera ya faragha — tunarekodi nani amekubali toleo gani, lini.
-- Safu mpya tu (zinaanza tupu). Hakuna kinachofutwa wala kubadilishwa.
ALTER TABLE naya.users
  ADD COLUMN terms_version      varchar(20),
  ADD COLUMN terms_accepted_at  timestamptz;

ALTER TABLE naya.drivers
  ADD COLUMN driver_terms_version     varchar(20),
  ADD COLUMN driver_terms_accepted_at timestamptz;
