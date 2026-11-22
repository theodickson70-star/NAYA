-- =====================================================================
-- PayPoint — Kituo Chako cha Pesa
-- Majedwali yote yako kwenye schema "paypoint" (Supabase ileile ya NAYA; schema "naya" haiguswi).
-- Fedha zote ni TSh kamili (BIGINT), hakuna senti.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Biashara (mmiliki mmoja, inaweza kuwa na maduka mengi)
CREATE TABLE paypoint.biashara (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jina            varchar(120) NOT NULL,
  simu            varchar(15),
  tarehe_imeundwa timestamptz NOT NULL DEFAULT now()
);

-- Maduka / vibanda vya uwakala
CREATE TABLE paypoint.maduka (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biashara_id         uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  jina                varchar(120) NOT NULL,
  namba_leseni        varchar(60),
  mahali              varchar(160),
  active              boolean NOT NULL DEFAULT true,
  float_chini         bigint NOT NULL DEFAULT 100000 CHECK (float_chini >= 0),  -- tahadhari float ikishuka chini ya hapa
  cash_chini          bigint NOT NULL DEFAULT 100000 CHECK (cash_chini >= 0),
  tarehe_imeundwa     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maduka_biashara_idx ON paypoint.maduka (biashara_id);

-- Mitandao inayohudumiwa na kila duka (namba ya wakala / till)
CREATE TABLE paypoint.mitandao_duka (
  duka_id      uuid NOT NULL REFERENCES paypoint.maduka(id) ON DELETE CASCADE,
  mtandao      varchar(12) NOT NULL CHECK (mtandao IN ('mpesa','mixx','airtel','halopesa','tpesa')),
  namba_wakala varchar(30),
  PRIMARY KEY (duka_id, mtandao)
);

-- Watumiaji: mmiliki (owner) na wafanyakazi (agent)
CREATE TABLE paypoint.watumiaji (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biashara_id     uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  duka_id         uuid REFERENCES paypoint.maduka(id) ON DELETE SET NULL,
  jina            varchar(120) NOT NULL,
  username        varchar(40) NOT NULL,
  password_hash   text NOT NULL,
  simu            varchar(15),
  role            varchar(10) NOT NULL CHECK (role IN ('owner','agent')),
  active          boolean NOT NULL DEFAULT true,
  lazima_abadilishe_password boolean NOT NULL DEFAULT false,
  ameingia_mwisho timestamptz,
  tarehe_imeundwa timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX watumiaji_username_idx ON paypoint.watumiaji (lower(username));
CREATE INDEX watumiaji_biashara_idx ON paypoint.watumiaji (biashara_id);

-- Vikao vya kuingia (cookie ina token; hapa tunahifadhi hash yake tu)
CREATE TABLE paypoint.vikao (
  token_hash   char(64) PRIMARY KEY,
  mtumiaji_id  uuid NOT NULL REFERENCES paypoint.watumiaji(id) ON DELETE CASCADE,
  csrf         char(43) NOT NULL,
  ujumbe       jsonb,                        -- flash message ya ukurasa unaofuata
  ip           varchar(64),
  kifaa        varchar(200),
  tarehe       timestamptz NOT NULL DEFAULT now(),
  inaisha      timestamptz NOT NULL
);
CREATE INDEX vikao_mtumiaji_idx ON paypoint.vikao (mtumiaji_id);

-- Wateja (daftari: jina na simu; salio la mteja liko kwenye mtandao wake, si hapa)
CREATE TABLE paypoint.wateja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biashara_id     uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  jina            varchar(120),
  simu            varchar(15) NOT NULL,
  maelezo         varchar(300),
  ameandikwa_na   uuid REFERENCES paypoint.watumiaji(id) ON DELETE SET NULL,
  tarehe_imeundwa timestamptz NOT NULL DEFAULT now(),
  UNIQUE (biashara_id, simu)
);

-- Miamala ya wateja (haifutwi kamwe)
--   tuma = mteja analeta cash, wakala anatuma pesa kwa simu  → cash +, float ya mtandao −
--   toa  = mteja anamtumia wakala pesa, anapewa cash          → cash −, float ya mtandao +
CREATE TABLE paypoint.miamala (
  id                bigserial PRIMARY KEY,                  -- namba ya risiti
  biashara_id       uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  duka_id           uuid NOT NULL REFERENCES paypoint.maduka(id),
  aina              varchar(4) NOT NULL CHECK (aina IN ('tuma','toa')),
  mtandao           varchar(12) NOT NULL CHECK (mtandao IN ('mpesa','mixx','airtel','halopesa','tpesa')),
  mteja_id          uuid REFERENCES paypoint.wateja(id) ON DELETE SET NULL,
  simu_mteja        varchar(15),
  jina_mteja        varchar(120),
  mtumiaji_id       uuid NOT NULL REFERENCES paypoint.watumiaji(id),
  kiasi             bigint NOT NULL CHECK (kiasi > 0),
  kamisheni         bigint NOT NULL DEFAULT 0 CHECK (kamisheni >= 0),
  kumbukumbu_namba  varchar(40),                            -- Ref ya SMS ya mtandao
  maelezo           varchar(200),
  imebatilishwa     boolean NOT NULL DEFAULT false,
  sababu_kubatilisha varchar(200),
  batilishwa_saa    timestamptz,
  tarehe            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX miamala_biashara_tarehe_idx ON paypoint.miamala (biashara_id, tarehe DESC);
CREATE INDEX miamala_duka_idx ON paypoint.miamala (duka_id, tarehe DESC);
CREATE INDEX miamala_mtumiaji_idx ON paypoint.miamala (mtumiaji_id, tarehe DESC);
CREATE INDEX miamala_mteja_idx ON paypoint.miamala (mteja_id);

-- Float na cash ya duka: mmiliki pekee ndiye anayeingiza/kutoa
CREATE TABLE paypoint.harakati (
  id           bigserial PRIMARY KEY,
  biashara_id  uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  duka_id      uuid NOT NULL REFERENCES paypoint.maduka(id),
  aina         varchar(12) NOT NULL CHECK (aina IN ('float_ingia','float_toka','cash_ingia','cash_toka','nunua_float','uza_float','matumizi')),
  mtandao      varchar(12) CHECK (mtandao IN ('mpesa','mixx','airtel','halopesa','tpesa')),
  kiasi        bigint NOT NULL CHECK (kiasi > 0),
  maelezo      varchar(200),
  mtumiaji_id  uuid NOT NULL REFERENCES paypoint.watumiaji(id),
  tarehe       timestamptz NOT NULL DEFAULT now(),
  CHECK ((aina IN ('cash_ingia','cash_toka','matumizi')) = (mtandao IS NULL))
);
CREATE INDEX harakati_duka_idx ON paypoint.harakati (duka_id, tarehe DESC);

-- Kamisheni: asilimia kwa kila mtandao na aina (chaguo-msingi: tuma 1%, toa 1.5%, angalau TSh 100)
CREATE TABLE paypoint.kamisheni_asilimia (
  biashara_id   uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  mtandao       varchar(12) NOT NULL,
  aina          varchar(4) NOT NULL CHECK (aina IN ('tuma','toa')),
  asilimia      numeric(5,2) NOT NULL CHECK (asilimia >= 0 AND asilimia <= 20),
  kiwango_chini bigint NOT NULL DEFAULT 100 CHECK (kiwango_chini >= 0),
  PRIMARY KEY (biashara_id, mtandao, aina)
);

-- Kamisheni kwa ngazi (kama mtandao unavyolipa). Ngazi ikipatikana inatumika badala ya asilimia.
CREATE TABLE paypoint.kamisheni_ngazi (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biashara_id  uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  mtandao      varchar(12) NOT NULL,
  aina         varchar(4) NOT NULL CHECK (aina IN ('tuma','toa')),
  kuanzia      bigint NOT NULL CHECK (kuanzia > 0),
  hadi         bigint NOT NULL,
  kamisheni    bigint NOT NULL CHECK (kamisheni >= 0),
  CHECK (hadi >= kuanzia)
);
CREATE INDEX kamisheni_ngazi_idx ON paypoint.kamisheni_ngazi (biashara_id, mtandao, aina);

-- Hesabu ya siku: wakala anahesabu cash na float halisi, mfumo unalinganisha
CREATE TABLE paypoint.hesabu (
  id            bigserial PRIMARY KEY,
  biashara_id   uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  duka_id       uuid NOT NULL REFERENCES paypoint.maduka(id),
  mtumiaji_id   uuid NOT NULL REFERENCES paypoint.watumiaji(id),
  cash_mfumo    bigint NOT NULL,
  cash_halisi   bigint NOT NULL,
  floats        jsonb NOT NULL,     -- [{mtandao, mfumo, halisi, tofauti}]
  tofauti       bigint NOT NULL,    -- jumla (halisi − mfumo); hasi = upungufu
  maelezo       varchar(300),
  tarehe        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hesabu_biashara_idx ON paypoint.hesabu (biashara_id, tarehe DESC);

-- Kumbukumbu (audit log): kila kitendo. Haibadilishwi wala kufutwa na mfumo.
CREATE TABLE paypoint.kumbukumbu (
  id           bigserial PRIMARY KEY,
  biashara_id  uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  mtumiaji_id  uuid REFERENCES paypoint.watumiaji(id) ON DELETE SET NULL,
  jina         varchar(120),
  kitendo      varchar(20) NOT NULL,
  maelezo      varchar(500) NOT NULL,
  ip           varchar(64),
  tarehe       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kumbukumbu_biashara_idx ON paypoint.kumbukumbu (biashara_id, tarehe DESC);

-- Arifa kwa mmiliki (ndani ya mfumo)
CREATE TABLE paypoint.arifa (
  id           bigserial PRIMARY KEY,
  biashara_id  uuid NOT NULL REFERENCES paypoint.biashara(id) ON DELETE CASCADE,
  aina         varchar(20) NOT NULL,
  ujumbe       varchar(400) NOT NULL,
  imesomwa     boolean NOT NULL DEFAULT false,
  tarehe       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX arifa_biashara_idx ON paypoint.arifa (biashara_id, tarehe DESC);

-- Kinga ya mwisho: miamala na kumbukumbu haziwezi kufutwa; kumbukumbu haziwezi kubadilishwa
CREATE FUNCTION paypoint.zuia_kufuta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rekodi hii ni ya kudumu: haiwezi kufutwa';
END $$;
CREATE TRIGGER miamala_hazifutwi BEFORE DELETE ON paypoint.miamala FOR EACH ROW EXECUTE FUNCTION paypoint.zuia_kufuta();
CREATE TRIGGER kumbukumbu_hazifutwi BEFORE DELETE OR UPDATE ON paypoint.kumbukumbu FOR EACH ROW EXECUTE FUNCTION paypoint.zuia_kufuta();
CREATE TRIGGER harakati_hazifutwi BEFORE DELETE ON paypoint.harakati FOR EACH ROW EXECUTE FUNCTION paypoint.zuia_kufuta();

-- Supabase: zuia API ya umma (anon key) isifikie majedwali haya. Server yetu inaunganishwa moja kwa moja.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'paypoint' LOOP
    EXECUTE format('ALTER TABLE paypoint.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
