-- 0.29.0: SMS kwa ratiba, SMS za moja kwa moja, kujiondoa kwenye SMS za matangazo, na gharama kwa TSh.
-- Haifuti wala haibadilishi data iliyopo: safu mpya (NULL / 0) na majedwali mapya 2.

-- Mteja/dereva hataki SMS za matangazo (Kituo cha SMS, SMS za moja kwa moja). SMS za huduma (namba ya
-- uthibitisho, password, pesa, usalama) bado zinamfikia.
ALTER TABLE naya.users ADD COLUMN sms_opt_out_at timestamptz;

-- Ratiba: SMS ya kutumwa baadaye (mara moja) au kujirudia (kila siku / kila wiki).
CREATE TABLE naya.sms_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience      varchar(30) NOT NULL,
  numbers       text,                                     -- kwa "Namba maalum" tu
  message       varchar(480) NOT NULL,
  template_id   uuid REFERENCES naya.sms_templates(id) ON DELETE SET NULL,
  important     boolean NOT NULL DEFAULT false,           -- ujumbe wa huduma: unawafikia hata waliojiondoa
  repeat        varchar(10) NOT NULL DEFAULT 'NONE' CHECK (repeat IN ('NONE', 'DAILY', 'WEEKLY')),
  run_at        timestamptz NOT NULL,                     -- itatumwa lini (inayofuata)
  status        varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'DONE', 'CANCELLED')),
  runs          int NOT NULL DEFAULT 0,
  last_run_at   timestamptz,
  last_campaign_id uuid REFERENCES naya.sms_campaigns(id) ON DELETE SET NULL,
  last_note     varchar(200),
  created_by    uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_schedules_due_idx ON naya.sms_schedules (run_at) WHERE status = 'ACTIVE';

ALTER TABLE naya.sms_campaigns ADD COLUMN schedule_id uuid REFERENCES naya.sms_schedules(id) ON DELETE SET NULL;
ALTER TABLE naya.sms_campaigns ADD COLUMN important boolean NOT NULL DEFAULT false;
ALTER TABLE naya.sms_campaigns ADD COLUMN skipped_opt_out int NOT NULL DEFAULT 0;
ALTER TABLE naya.sms_campaigns ADD COLUMN price_tzs int NOT NULL DEFAULT 0; -- bei ya SMS moja wakati wa kutuma

-- SMS za moja kwa moja: nani amepata SMS ya kanuni gani na lini (mtu asipate ileile mara mbili).
CREATE TABLE naya.sms_auto_log (
  id        bigserial PRIMARY KEY,
  rule      varchar(30) NOT NULL,
  user_id   uuid NOT NULL REFERENCES naya.users(id) ON DELETE CASCADE,
  phone     varchar(15) NOT NULL,
  ok        boolean,
  sent_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_auto_log_rule_user_idx ON naya.sms_auto_log (rule, user_id, sent_at DESC);
CREATE INDEX sms_auto_log_sent_idx ON naya.sms_auto_log (sent_at DESC);

ALTER TABLE naya.sms_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.sms_auto_log ENABLE ROW LEVEL SECURITY;
