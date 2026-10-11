-- Phase 7: arifa (notifications) za watumiaji na usajili wa Web Push. Tables mpya tu — hakuna kinachofutwa.

-- Kila arifa iliyotumwa kwa mtumiaji (inaonekana pia kwenye app: Akaunti → Arifa).
CREATE TABLE naya.notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  kind       varchar(30) NOT NULL,
  title      varchar(120) NOT NULL,
  body       varchar(300),
  ride_id    uuid REFERENCES naya.rides(id) ON DELETE SET NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON naya.notifications (user_id, created_at DESC);

-- Simu/browser zilizokubali arifa (Web Push). endpoint ni ya kipekee kwa kila kifaa.
CREATE TABLE naya.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      varchar(300),
  failures        integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON naya.push_subscriptions (user_id);

ALTER TABLE naya.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.push_subscriptions ENABLE ROW LEVEL SECURITY;
