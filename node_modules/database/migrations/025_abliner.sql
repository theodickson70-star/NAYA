-- 0.17.0 Abliner: kumbukumbu ya kila webhook iliyothibitishwa (kuzuia tukio moja kuchakatwa mara mbili — x-webhook-id
-- ni ileile Abliner ikijaribu tena). Inaongeza jedwali jipya TU; haibadilishi wala kufuta data iliyopo.
CREATE TABLE IF NOT EXISTS naya.payment_webhook_events (
  provider     varchar(30)  NOT NULL,
  event_id     varchar(100) NOT NULL,
  event        varchar(40),
  reference    varchar(40),
  status       varchar(10),
  outcome      varchar(20)  NOT NULL,   -- APPLIED | IGNORED | UNKNOWN_REFERENCE | AMOUNT_MISMATCH
  received_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS payment_webhook_events_reference_idx ON naya.payment_webhook_events (reference);
ALTER TABLE naya.payment_webhook_events ENABLE ROW LEVEL SECURITY;
