-- Phase 11.1: Maoni — abiria na madereva wanatoa maoni/ushauri kuhusu NAYA; ofisi inayasoma na kuyafanyia kazi.
-- Table mpya tu — hakuna kinachofutwa.
CREATE TABLE naya.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  role        varchar(10) NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  topic       varchar(20) NOT NULL DEFAULT 'GENERAL' CHECK (topic IN ('GENERAL', 'APP', 'PRICES', 'DRIVERS', 'SAFETY', 'IDEA')),
  body        varchar(1000) NOT NULL,
  status      varchar(10) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWED', 'ACTED')),
  office_note varchar(500),             -- ofisi imefanya nini (mtumiaji analiona)
  handled_by  uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_status_idx ON naya.feedback (status, created_at DESC);
CREATE INDEX feedback_user_idx ON naya.feedback (user_id, created_at DESC);

ALTER TABLE naya.feedback ENABLE ROW LEVEL SECURITY;
