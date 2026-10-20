-- 0.25.0: Safari ya mtu mwingine — abiria anamwagizia mtu mwingine safari (jina + namba ya anayesafiri).
-- Aliyeagiza (passenger_id) ndiye analipa na kubeba deni; dereva anampigia anayesafiri.
-- Anayesafiri anapata SMS yenye link ya kufuatilia safari na kitufe cha dharura (hata bila app).
-- Haifuti wala haibadilishi data iliyopo: safu mpya ni NULL kwa safari zote za zamani.

ALTER TABLE naya.rides
  ADD COLUMN rider_name        varchar(60),
  ADD COLUMN rider_phone       varchar(15),
  ADD COLUMN rider_token_hash  bytea,       -- SHA-256 ya link ya anayesafiri (link yenyewe haihifadhiwi)
  ADD COLUMN rider_sms_at      timestamptz; -- SMS ya "dereva anakuja" ilitumwa lini

ALTER TABLE naya.rides
  ADD CONSTRAINT rides_rider_pair_check CHECK ((rider_name IS NULL) = (rider_phone IS NULL));

CREATE UNIQUE INDEX rides_rider_token_unique ON naya.rides (rider_token_hash) WHERE rider_token_hash IS NOT NULL;

-- Dharura kutoka kwa anayesafiri (kupitia link) — inaandikwa chini ya akaunti ya aliyeagiza, role RIDER.
ALTER TABLE naya.sos_alerts DROP CONSTRAINT IF EXISTS sos_alerts_role_check;
ALTER TABLE naya.sos_alerts ADD CONSTRAINT sos_alerts_role_check CHECK (role IN ('PASSENGER', 'DRIVER', 'RIDER'));
