-- Phase 11: Ofisi kuu — msaada (malalamiko), maelezo ya ndani kuhusu watumiaji, na matangazo.
-- Tables mpya na safu moja mpya tu — hakuna kinachofutwa.

-- Sababu ya kumsimamisha mtumiaji (inaonekana ofisini; mtumiaji anaambiwa awasiliane na ofisi).
ALTER TABLE naya.users ADD COLUMN suspended_reason varchar(300);

-- Tatizo/lalamiko kutoka kwa abiria au dereva ("Msaada" kwenye app).
CREATE TABLE naya.support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  ride_id      uuid REFERENCES naya.rides(id) ON DELETE SET NULL,
  role         varchar(10) NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
  category     varchar(20) NOT NULL CHECK (category IN ('RIDE', 'FARE', 'DRIVER', 'PASSENGER', 'LOST_ITEM', 'SAFETY', 'APP', 'ACCOUNT', 'OTHER')),
  status       varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED', 'RESOLVED')),
  subject      varchar(120) NOT NULL,
  user_unread  boolean NOT NULL DEFAULT false, -- ofisi imejibu na mtumiaji bado hajaona
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX support_tickets_status_idx ON naya.support_tickets (status, updated_at DESC);
CREATE INDEX support_tickets_user_idx ON naya.support_tickets (user_id, created_at DESC);

CREATE TABLE naya.support_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES naya.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  from_staff  boolean NOT NULL,
  body        varchar(1000) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON naya.support_messages (ticket_id, id);

-- Maelezo ya ndani ya ofisi kuhusu mtumiaji (mtumiaji hayaoni).
CREATE TABLE naya.user_notes (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  body        varchar(1000) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_notes_user_idx ON naya.user_notes (user_id, created_at DESC);

-- Matangazo yaliyotumwa na ofisi (kwa kumbukumbu).
CREATE TABLE naya.broadcasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience    varchar(20) NOT NULL CHECK (audience IN ('ALL', 'PASSENGERS', 'DRIVERS', 'ONLINE_DRIVERS')),
  title       varchar(80) NOT NULL,
  body        varchar(300) NOT NULL,
  with_sms    boolean NOT NULL DEFAULT false,
  recipients  integer NOT NULL DEFAULT 0,
  sms_sent    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE naya.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.broadcasts ENABLE ROW LEVEL SECURITY;
