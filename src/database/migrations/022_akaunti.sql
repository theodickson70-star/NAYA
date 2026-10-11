-- 0.15.0 Akaunti mpya: picha ya mtumiaji (dereva anaiona akipokea ombi) na mtu wa dharura.
-- Inaongeza safu tu — haifuti wala kubadilisha data iliyopo.
ALTER TABLE naya.users ADD COLUMN photo_file_id uuid REFERENCES naya.document_files(id) ON DELETE SET NULL;
ALTER TABLE naya.users ADD COLUMN photo_updated_at timestamptz;
ALTER TABLE naya.users ADD COLUMN emergency_name varchar(80);
ALTER TABLE naya.users ADD COLUMN emergency_phone varchar(15);
