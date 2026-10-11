-- Ripoti za ofisi: mtumiaji anatumia app ya Android (APK) au link (browser)?
-- Columns mpya tu (hakuna kinachofutwa). App inatuma kichwa x-naya-client: apk | web, server inakumbuka cha mwisho.
ALTER TABLE naya.users ADD COLUMN app_client varchar(10) CHECK (app_client IN ('apk', 'web'));
ALTER TABLE naya.users ADD COLUMN app_seen_at timestamptz;   -- mara ya mwisho kufungua app (APK au link)
ALTER TABLE naya.users ADD COLUMN apk_since timestamptz;     -- mara ya kwanza kuonekana kwenye APK

-- Waliokwisha sajili simu yao ya APK kwa kengele (Firebase) — tunajua tayari wanatumia APK.
UPDATE naya.users u
   SET app_client = 'apk',
       apk_since = t.first_at,
       app_seen_at = greatest(t.last_at, u.last_login_at)
  FROM (SELECT user_id, min(created_at) AS first_at, max(updated_at) AS last_at FROM naya.fcm_tokens GROUP BY user_id) t
 WHERE t.user_id = u.id;

CREATE INDEX users_app_client_idx ON naya.users (app_client) WHERE role = 'USER';
