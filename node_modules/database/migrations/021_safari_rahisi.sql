-- Safari rahisi kama Bolt: PIN inabaki kwa safari za ofa tu (NAYA inalipa pesa → kinga ya "safari hewa").
-- GPS inasaidia: "amefika" yenyewe, safari inaanza yenyewe dereva akiondoka na abiria, na inamalizwa yenyewe
-- dakika chache baada ya kufika unakoenda. Safari za kutiliwa shaka zinawekewa alama kwa ofisi.
-- Columns mpya tu; hakuna data inayofutwa.
ALTER TABLE naya.rides ADD COLUMN flags text[] NOT NULL DEFAULT '{}';            -- mf. {START_FAR, ENDED_FAR, TOO_SHORT}
ALTER TABLE naya.rides ADD COLUMN near_dest_at timestamptz;                     -- dereva alifika karibu na unakoenda
ALTER TABLE naya.rides ADD COLUMN auto_arrived boolean NOT NULL DEFAULT false;
ALTER TABLE naya.rides ADD COLUMN auto_started boolean NOT NULL DEFAULT false;
ALTER TABLE naya.rides ADD COLUMN completed_by varchar(10) CHECK (completed_by IN ('DRIVER', 'PASSENGER', 'AUTO', 'ADMIN'));

-- Safari zinazoendelea ambazo si za ofa hazihitaji PIN tena.
UPDATE naya.rides SET start_pin = NULL
 WHERE status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED') AND promo_discount = 0 AND start_pin IS NOT NULL;

CREATE INDEX rides_in_progress_idx ON naya.rides (status, near_dest_at) WHERE status = 'IN_PROGRESS';
