-- 0.26.0: Kituo cha SMS ofisini — templates za wateja na madereva, kutuma SMS kwa kundi au namba, na historia.
-- Haifuti wala haibadilishi data iliyopo: majedwali mapya 2, safu moja mpya (NULL) kwenye sms_log, na templates za mwanzo.

CREATE TABLE naya.sms_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience    varchar(10) NOT NULL CHECK (audience IN ('CUSTOMERS', 'DRIVERS', 'ALL')),
  title       varchar(60) NOT NULL,
  body        varchar(480) NOT NULL,
  archived    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_templates_active_idx ON naya.sms_templates (audience, title) WHERE NOT archived;

-- Kila "tuma" moja ya ofisi (kundi au namba). Maandishi yanahifadhiwa hapa (si siri kama OTP);
-- matokeo ya kila namba yako kwenye sms_log (campaign_id).
CREATE TABLE naya.sms_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience     varchar(30) NOT NULL,
  target_key   varchar(64) NOT NULL,      -- kundi, au SHA-256 ya namba (kuzuia kutuma mara mbili kwa watu walewale)
  template_id  uuid REFERENCES naya.sms_templates(id) ON DELETE SET NULL,
  message      varchar(480) NOT NULL,
  total        int NOT NULL CHECK (total >= 0),
  sent         int NOT NULL DEFAULT 0,
  failed       int NOT NULL DEFAULT 0,
  units        int NOT NULL DEFAULT 0,    -- makadirio ya SMS (sehemu) zilizotumika
  status       varchar(10) NOT NULL DEFAULT 'SENDING' CHECK (status IN ('SENDING', 'DONE', 'STOPPED')),
  created_by   uuid REFERENCES naya.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX sms_campaigns_created_idx ON naya.sms_campaigns (created_at DESC);

ALTER TABLE naya.sms_log ADD COLUMN campaign_id uuid REFERENCES naya.sms_campaigns(id) ON DELETE SET NULL;
CREATE INDEX sms_log_campaign_idx ON naya.sms_log (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE naya.sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE naya.sms_campaigns ENABLE ROW LEVEL SECURITY;

-- Templates za mwanzo (ofisi inaweza kuzibadilisha au kuziondoa). Maneno ndani ya {} yanajazwa kwa kila mtu.
-- Zimeandikwa fupi ili kila moja iwe SMS 1 (herufi ≤160) hata ikiwa na link.
INSERT INTO naya.sms_templates (audience, title, body) VALUES
  ('CUSTOMERS', 'Karibu NAYA',
   'Habari {jina}, karibu NAYA! Agiza bodaboda au bajaji Urambo: {link} TWENDE PAMOJA.'),
  ('CUSTOMERS', 'Tumekukumbuka',
   'Habari {jina}, tumekukumbuka! Madereva wa NAYA wako tayari. Agiza sasa: {link}'),
  ('CUSTOMERS', 'Ofa ya wiki',
   'Habari {jina}, NAYA ina ofa: [andika ofa hapa]. Agiza: {link}'),
  ('CUSTOMERS', 'Lipa taslimu kwa muda',
   'NAYA: Malipo kwa simu yana hitilafu kwa muda. Tafadhali lipa dereva taslimu. Tutawajulisha yakirudi. Asante.'),
  ('DRIVERS', 'Ada inakaribia kuisha',
   'Habari {jina}, ada yako ya NAYA inaisha {ada_hadi}. Lipa mapema kupitia app: Akaunti > Ada ya mwezi, uendelee kupata safari.'),
  ('DRIVERS', 'Wateja wengi sasa',
   'Habari {jina}, kuna wateja wengi sasa hivi. Fungua NAYA uende online upate safari. TWENDE PAMOJA.'),
  ('DRIVERS', 'Kikao cha madereva',
   'NAYA: Madereva wote mnaalikwa kikao [tarehe] saa [saa] ofisini. Karibuni.'),
  ('DRIVERS', 'Toleo jipya la app',
   'Habari {jina}, toleo jipya la app ya NAYA lipo. Pakua: {link_pakua}'),
  ('ALL', 'Usalama: PIN',
   'NAYA: Kumbuka, NAYA haitakuuliza PIN wala password kamwe. Usimpe mtu yeyote, hata akisema anatoka ofisi ya NAYA.');
